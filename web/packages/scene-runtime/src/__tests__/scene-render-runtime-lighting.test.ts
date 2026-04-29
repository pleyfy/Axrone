import { Actor, Transform, World } from '@axrone/ecs-runtime';
import { Vec3, Vec4 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import { Camera } from '../components/camera';
import { DirectionalLight } from '../components/directional-light';
import { MeshRenderer } from '../components/mesh-renderer';
import { PointLight } from '../components/point-light';
import type { SceneMaterialResource } from '../material-registry';
import type { SceneMeshResource } from '../mesh-registry';
import type { SceneRenderPassResource } from '../render-pass-registry';
import { SceneRenderRuntime } from '../scene-render-runtime';
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
        NONE: 0,
        LESS: 0x0201,
        TEXTURE0: 0x84c0,
        TEXTURE_2D: 0x0de1,
        viewport: vi.fn(),
        clearColor: vi.fn(),
        clearDepth: vi.fn(),
        clear: vi.fn(),
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
        bindTexture: vi.fn(),
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
    uniformNames: readonly string[]
): SceneShaderResource => {
    const locationEntries = uniformNames.map((name) => [
        name,
        { name } as unknown as WebGLUniformLocation,
    ] as const);

    return {
        id: 'shader',
        program: {} as WebGLProgram,
        uniformLocations: new Map(locationEntries),
        uniformTypes: new Map([
            ['u_ReceiveLighting', gl.BOOL],
            ['u_LightColor', gl.FLOAT_VEC3],
            ['u_LightIntensity', gl.FLOAT],
            ['u_LocalLightCount', gl.INT],
            ['u_LocalLightType', gl.INT],
            ['u_LocalLightPosition', gl.FLOAT_VEC3],
        ]),
        uniformNames: [...uniformNames],
        attributeNames: { position: 'a_Position' },
        depthTest: false,
        cull: false,
        blend: false,
    };
};

describe('SceneRenderRuntime lighting integration', () => {
    it('uses the primary camera when ordering local lights through the render path', () => {
        const { gl, uniformWrites } = createMockGL();
        const world = new World(createSceneRegistry());

        const fallbackCameraActor = new Actor(world);
        fallbackCameraActor.addComponent(Camera, { primary: false });
        fallbackCameraActor.requireComponent(Transform).position = new Vec3(20, 0, 0);

        const primaryCameraActor = new Actor(world);
        primaryCameraActor.addComponent(Camera, { primary: true });
        primaryCameraActor.requireComponent(Transform).position = Vec3.ZERO.clone();

        const farLightActor = new Actor(world);
        farLightActor.addComponent(PointLight, {
            color: [1, 0, 0],
            intensity: 8,
            range: 5,
        });
        farLightActor.requireComponent(Transform).position = new Vec3(20, 0, 0);

        const nearLightActor = new Actor(world);
        nearLightActor.addComponent(PointLight, {
            color: [0, 1, 0],
            intensity: 2,
            range: 8,
        });
        nearLightActor.requireComponent(Transform).position = new Vec3(1, 0, 0);

        const directionalLightActor = new Actor(world);
        directionalLightActor.addComponent(DirectionalLight, {
            color: [0.9, 0.8, 0.7],
            intensity: 3,
            primary: true,
        });
        directionalLightActor.requireComponent(Transform);

        const rendererActor = new Actor(world);
        rendererActor.addComponent(MeshRenderer, {
            meshId: 'mesh',
            materialId: 'material',
            passId: 'main',
            receiveLighting: true,
        });
        rendererActor.requireComponent(Transform);

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
            'u_LightColor',
            'u_LightIntensity',
            'u_LocalLightCount',
            'u_LocalLightType',
            'u_LocalLightPosition',
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
            getActors: () => world.getAllActors(),
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

        const lightColor = uniformWrites.get('u_LightColor') as number[];

        expect(uniformWrites.get('u_ReceiveLighting')).toBe(1);
        expect(lightColor[0]).toBeCloseTo(0.9);
        expect(lightColor[1]).toBeCloseTo(0.8);
        expect(lightColor[2]).toBeCloseTo(0.7);
        expect(uniformWrites.get('u_LightIntensity')).toBe(3);
        expect(uniformWrites.get('u_LocalLightCount')).toBe(2);
        expect(uniformWrites.get('u_LocalLightType')).toEqual([0, 0]);
        expect((uniformWrites.get('u_LocalLightPosition') as number[]).slice(0, 6)).toEqual([
            1, 0, 0,
            20, 0, 0,
        ]);
        expect((gl.drawArrays as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
        expect(runtime.stats.drawCalls).toBe(1);
        expect(runtime.stats.trianglesSubmitted).toBe(1);
    });
});