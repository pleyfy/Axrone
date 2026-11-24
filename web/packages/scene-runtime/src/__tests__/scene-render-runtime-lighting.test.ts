import { Entity, Transform, World } from '@axrone/ecs-runtime';
import { Vec3, Vec4 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import { Camera } from '../components/camera';
import { DirectionalLight } from '../components/directional-light';
import { MeshRenderer } from '../components/mesh-renderer';
import { PointLight } from '../components/point-light';
import type { SceneMaterialResource } from '../material-registry';
import type { SceneMeshResource } from '../mesh-registry';
import type { SceneRenderPassResource } from '../rendering/render-pass-registry';
import { SceneRenderRuntime } from '../rendering/scene-render-runtime';
import { createSceneRegistry } from '../scene-registry';
import type { SceneResourceRuntime } from '../scene-resource-runtime';
import type { SceneShaderResource } from '../shader-registry';
import type { SceneMeshDefinition } from '../types';

const createMockGL = () => {
    const uniformWrites = new Map<string, unknown>();
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
        createTexture: vi.fn(() => ({} as WebGLTexture)),
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
        uniformMatrix4fv: vi.fn((location: WebGLUniformLocation, _transpose: boolean, value: Float32Array) => {
            uniformWrites.set((location as { name: string }).name, Array.from(value));
        }),
        uniform3f: vi.fn((location: WebGLUniformLocation, x: number, y: number, z: number) => {
            uniformWrites.set((location as { name: string }).name, [x, y, z]);
        }),
        uniform1f: vi.fn((location: WebGLUniformLocation, value: number) => {
            uniformWrites.set((location as { name: string }).name, value);
        }),
        uniform1i: vi.fn((location: WebGLUniformLocation, value: number) => {
            uniformWrites.set((location as { name: string }).name, value);
        }),
        uniform3fv: vi.fn((location: WebGLUniformLocation, value: Float32Array) => {
            uniformWrites.set((location as { name: string }).name, Array.from(value));
        }),
        uniform1fv: vi.fn((location: WebGLUniformLocation, value: Float32Array) => {
            uniformWrites.set((location as { name: string }).name, Array.from(value));
        }),
        uniform1iv: vi.fn((location: WebGLUniformLocation, value: Int32Array) => {
            uniformWrites.set((location as { name: string }).name, Array.from(value));
        }),
        drawArrays: vi.fn(),
        drawElements: vi.fn(),
    };

    return {
        gl: gl as unknown as WebGL2RenderingContext,
        uniformWrites,
    };
};

const createSceneShader = (
    gl: WebGL2RenderingContext,
    uniformNames: readonly string[],
    options: {
        readonly id?: string;
        readonly blend?: boolean;
    } = {}
): SceneShaderResource => {
    const locationEntries = uniformNames.map((name) => [
        name,
        { name } as unknown as WebGLUniformLocation,
    ] as const);

    return {
        id: options.id ?? 'shader',
        program: {} as WebGLProgram,
        uniformLocations: new Map(locationEntries),
        uniformTypes: new Map([
            ['u_ReceiveLighting', gl.BOOL],
            ['u_DirectionalLightCount', gl.INT],
            ['u_DirectionalLightColor', gl.FLOAT_VEC3],
            ['u_DirectionalLightIntensity', gl.FLOAT],
            ['u_PointLightCount', gl.INT],
            ['u_PointLightPosition', gl.FLOAT_VEC3],
        ]),
        uniformNames: [...uniformNames],
        attributeNames: { position: 'a_Position' },
        depthTest: false,
        cull: false,
        blend: options.blend ?? false,
    };
};

describe('SceneRenderRuntime lighting integration', () => {
    it('uses the primary camera when ordering local lights through the render path', () => {
        const { gl, uniformWrites } = createMockGL();
        const world = new World(createSceneRegistry());

        const fallbackCameraEntity = new Entity(world);
        fallbackCameraEntity.addComponent(Camera, { primary: false });
        fallbackCameraEntity.requireComponent(Transform).position = new Vec3(20, 0, 0);

        const primaryCameraEntity = new Entity(world);
        primaryCameraEntity.addComponent(Camera, { primary: true });
        primaryCameraEntity.requireComponent(Transform).position = Vec3.ZERO.clone();

        const farLightEntity = new Entity(world);
        farLightEntity.addComponent(PointLight, {
            color: [1, 0, 0],
            intensity: 8,
            range: 5,
        });
        farLightEntity.requireComponent(Transform).position = new Vec3(20, 0, 0);

        const nearLightEntity = new Entity(world);
        nearLightEntity.addComponent(PointLight, {
            color: [0, 1, 0],
            intensity: 2,
            range: 8,
        });
        nearLightEntity.requireComponent(Transform).position = new Vec3(1, 0, 0);

        const directionalLightEntity = new Entity(world);
        directionalLightEntity.addComponent(DirectionalLight, {
            color: [0.9, 0.8, 0.7],
            intensity: 3,
            primary: true,
        });
        directionalLightEntity.requireComponent(Transform);

        const rendererEntity = new Entity(world);
        rendererEntity.addComponent(MeshRenderer, {
            meshId: 'mesh',
            materialId: 'material',
            passId: 'main',
            receiveLighting: true,
        });
        rendererEntity.requireComponent(Transform);

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
            vertices: new Float32Array([
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ]),
            attributes: [
                {
                    semantic: 'position',
                    componentCount: 3,
                    offset: 0,
                    stride: 12,
                },
            ],
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
        const shader = createSceneShader(gl, [
            'u_ReceiveLighting',
            'u_DirectionalLightCount',
            'u_DirectionalLightColor',
            'u_DirectionalLightIntensity',
            'u_PointLightCount',
            'u_PointLightPosition',
        ]);
        const resources = {
            materials: {
                get: (id: string) => (id === material.id ? material : undefined),
                getTextureSlots: () => Object.freeze([]),
            },
            meshes: {
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
            getEntitys: () => world.getAllEntities(),
            createMeshResource: vi.fn(() => mesh),
            disposeMesh: vi.fn(),
            applyMissingVertexAttributeDefaults: vi.fn(),
        });

        runtime.render({
            frame: 1,
            elapsedSeconds: 1,
            deltaSeconds: 1 / 60,
            viewportWidth: 640,
            viewportHeight: 360,
        });

        const directionalLightColor = uniformWrites.get('u_DirectionalLightColor') as number[];

        expect(uniformWrites.get('u_ReceiveLighting')).toBe(1);
        expect(uniformWrites.get('u_DirectionalLightCount')).toBe(1);
        expect(directionalLightColor[0]).toBeCloseTo(0.9);
        expect(directionalLightColor[1]).toBeCloseTo(0.8);
        expect(directionalLightColor[2]).toBeCloseTo(0.7);
        expect(uniformWrites.get('u_DirectionalLightIntensity')).toEqual([3]);
        expect(uniformWrites.get('u_PointLightCount')).toBe(2);
        expect((uniformWrites.get('u_PointLightPosition') as number[]).slice(0, 6)).toEqual([
            1, 0, 0,
            20, 0, 0,
        ]);
        expect((gl.drawArrays as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
        expect(runtime.stats.drawCalls).toBe(1);
        expect(runtime.stats.trianglesSubmitted).toBe(1);
        expect(runtime.stats.planning.passCount).toBeGreaterThan(0);
        expect(runtime.stats.planning.opaqueCount).toBe(1);
        expect(runtime.stats.planning.transparentCount).toBe(0);
    });

    it('enforces transparent primitive budgets through render-core planning before execution', () => {
        const { gl } = createMockGL();
        const world = new World(createSceneRegistry());

        const cameraEntity = new Entity(world);
        cameraEntity.addComponent(Camera, { primary: true });
        cameraEntity.requireComponent(Transform);

        const opaqueEntity = new Entity(world);
        opaqueEntity.addComponent(MeshRenderer, {
            meshId: 'mesh',
            materialId: 'opaque-material',
            passId: 'main',
            receiveLighting: false,
        });
        opaqueEntity.requireComponent(Transform);

        const transparentEntityA = new Entity(world);
        transparentEntityA.addComponent(MeshRenderer, {
            meshId: 'mesh',
            materialId: 'transparent-material-a',
            passId: 'main',
            receiveLighting: false,
        });
        transparentEntityA.requireComponent(Transform);

        const transparentEntityB = new Entity(world);
        transparentEntityB.addComponent(MeshRenderer, {
            meshId: 'mesh',
            materialId: 'transparent-material-b',
            passId: 'main',
            receiveLighting: false,
        });
        transparentEntityB.requireComponent(Transform);

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
            vertices: new Float32Array([
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ]),
            attributes: [
                {
                    semantic: 'position',
                    componentCount: 3,
                    offset: 0,
                    stride: 12,
                },
            ],
            vertexCount: 3,
            topology: 'triangles',
        };
        const opaqueShader = createSceneShader(gl, [], {
            id: 'opaque-shader',
            blend: false,
        });
        const transparentShader = createSceneShader(gl, [], {
            id: 'transparent-shader',
            blend: true,
        });
        const opaqueMaterial: SceneMaterialResource = {
            id: 'opaque-material',
            shaderId: opaqueShader.id,
            uniforms: new Map(),
            textureBindings: new Map(),
            surface: {
                shadingModel: 'unlit',
                alphaMode: 'opaque',
            },
            passes: Object.freeze([]),
        };
        const transparentMaterialA: SceneMaterialResource = {
            id: 'transparent-material-a',
            shaderId: transparentShader.id,
            uniforms: new Map(),
            textureBindings: new Map(),
            surface: {
                shadingModel: 'unlit',
                alphaMode: 'blend',
            },
            passes: Object.freeze([]),
        };
        const transparentMaterialB: SceneMaterialResource = {
            id: 'transparent-material-b',
            shaderId: transparentShader.id,
            uniforms: new Map(),
            textureBindings: new Map(),
            surface: {
                shadingModel: 'unlit',
                alphaMode: 'blend',
            },
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
        const materials = new Map([
            [opaqueMaterial.id, opaqueMaterial],
            [transparentMaterialA.id, transparentMaterialA],
            [transparentMaterialB.id, transparentMaterialB],
        ]);
        const shaders = new Map([
            [opaqueShader.id, opaqueShader],
            [transparentShader.id, transparentShader],
        ]);
        const resources = {
            materials: {
                get: (id: string) => materials.get(id),
                getTextureSlots: () => Object.freeze([]),
            },
            meshes: {
                get: (id: string) => (id === mesh.id ? mesh : undefined),
                getDefinition: (id: string) => (id === mesh.id ? meshDefinition : undefined),
            },
            shaders: {
                get: (id: string) => shaders.get(id),
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
            planning: {
                maxTransparentPrimitives: 1,
            },
            getEntitys: () => world.getAllEntities(),
            createMeshResource: vi.fn(() => mesh),
            disposeMesh: vi.fn(),
            applyMissingVertexAttributeDefaults: vi.fn(),
        });

        runtime.render({
            frame: 2,
            elapsedSeconds: 2,
            deltaSeconds: 1 / 60,
            viewportWidth: 640,
            viewportHeight: 360,
        });

        expect((gl.drawArrays as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
        expect(runtime.stats.drawCalls).toBe(2);
        expect(runtime.stats.trianglesSubmitted).toBe(2);
        expect(runtime.stats.planning.opaqueCount).toBe(1);
        expect(runtime.stats.planning.transparentCount).toBe(1);
        expect(runtime.stats.planning.warnings).toEqual([
            'transparent primitive budget exceeded at 1',
        ]);
        expect(runtime.stats.planning.passCount).toBeGreaterThan(0);
    });
});