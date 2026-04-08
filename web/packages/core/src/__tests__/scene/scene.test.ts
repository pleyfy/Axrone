import { Vec3 } from '@axrone/numeric';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component } from '../../component-system/core/component';
import { Transform } from '../../component-system/components/transform';
import type { SceneOptions } from '../../scene';

const installWebGL2Constants = (): void => {
    const root = globalThis as typeof globalThis & {
        WebGL2RenderingContext?: typeof WebGL2RenderingContext;
    };

    if (root.WebGL2RenderingContext) {
        return;
    }

    let nextConstant = 0x2000;
    root.WebGL2RenderingContext = new Proxy(class WebGL2RenderingContext {}, {
        get(target, property, receiver) {
            if (typeof property === 'string' && !(property in target)) {
                Reflect.set(target, property, nextConstant++);
            }

            return Reflect.get(target, property, receiver);
        },
    }) as typeof WebGL2RenderingContext;
};

let Scene: typeof import('../../scene').Scene;
let MeshRenderer: typeof import('../../scene').MeshRenderer;
let DirectionalLight: typeof import('../../scene').DirectionalLight;
let OrbitCameraController: typeof import('../../scene').OrbitCameraController;
let PointLight: typeof import('../../scene').PointLight;
let SpotLight: typeof import('../../scene').SpotLight;

class ManualScheduler {
    readonly kind = 'manual';
    private _now = 0;
    private _nextHandle = 1;
    private readonly _callbacks = new Map<number, (timestamp: number) => void>();

    now(): number {
        return this._now;
    }

    request(callback: (timestamp: number) => void): number {
        const handle = this._nextHandle++;
        this._callbacks.set(handle, callback);
        return handle;
    }

    cancel(handle: number): void {
        this._callbacks.delete(handle);
    }

    flush(timestamp: number): void {
        this._now = timestamp;
        const callbacks = [...this._callbacks.values()];
        this._callbacks.clear();

        for (const callback of callbacks) {
            callback(timestamp);
        }
    }
}

class PulseComponent extends Component {
    fixedCalls = 0;
    updateCalls = 0;
    lateCalls = 0;

    fixedUpdate(): void {
        this.fixedCalls += 1;
    }

    update(): void {
        this.updateCalls += 1;
    }

    lateUpdate(): void {
        this.lateCalls += 1;
    }
}

class ParentAwareComponent extends Component {
    parentNameAtAwake: string | null = null;

    awake(): void {
        this.parentNameAtAwake = this.actor?.parent?.name ?? null;
    }
}

const createMockGL = (canvas: HTMLCanvasElement) => {
    const shaders = new Set<object>();
    const programs = new Set<object>();
    const buffers = new Set<object>();
    const vertexArrays = new Set<object>();
    const textures = new Set<object>();
    const samplers = new Set<object>();

    const gl = {
        canvas,
        ARRAY_BUFFER: 0x8892,
        ELEMENT_ARRAY_BUFFER: 0x8893,
        STATIC_DRAW: 0x88e4,
        FLOAT: 0x1406,
        FLOAT_VEC2: 0x8b50,
        FLOAT_VEC3: 0x8b51,
        FLOAT_VEC4: 0x8b52,
        FLOAT_MAT4: 0x8b5c,
        INT: 0x1404,
        INT_VEC2: 0x8b53,
        INT_VEC3: 0x8b54,
        INT_VEC4: 0x8b55,
        BOOL: 0x8b56,
        BOOL_VEC2: 0x8b57,
        BOOL_VEC3: 0x8b58,
        BOOL_VEC4: 0x8b59,
        UNSIGNED_BYTE: 0x1401,
        UNSIGNED_SHORT: 0x1403,
        UNSIGNED_INT: 0x1405,
        UNSIGNED_INT_VEC2: 0x8dc6,
        UNSIGNED_INT_VEC3: 0x8dc7,
        UNSIGNED_INT_VEC4: 0x8dc8,
        TRIANGLES: 0x0004,
        LINES: 0x0001,
        POINTS: 0x0000,
        VERTEX_SHADER: 0x8b31,
        FRAGMENT_SHADER: 0x8b30,
        COMPILE_STATUS: 0x8b81,
        LINK_STATUS: 0x8b82,
        COLOR_BUFFER_BIT: 0x4000,
        DEPTH_BUFFER_BIT: 0x0100,
        DEPTH_TEST: 0x0b71,
        CULL_FACE: 0x0b44,
        BLEND: 0x0be2,
        BACK: 0x0405,
        SRC_ALPHA: 0x0302,
        ONE_MINUS_SRC_ALPHA: 0x0303,
        TEXTURE_2D: 0x0de1,
        TEXTURE_3D: 0x806f,
        TEXTURE_CUBE_MAP: 0x8513,
        TEXTURE_2D_ARRAY: 0x8c1a,
        TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
        TEXTURE_CUBE_MAP_NEGATIVE_X: 0x8516,
        TEXTURE_CUBE_MAP_POSITIVE_Y: 0x8517,
        TEXTURE_CUBE_MAP_NEGATIVE_Y: 0x8518,
        TEXTURE_CUBE_MAP_POSITIVE_Z: 0x8519,
        TEXTURE_CUBE_MAP_NEGATIVE_Z: 0x851a,
        TEXTURE0: 0x84c0,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        TEXTURE_WRAP_R: 0x8072,
        TEXTURE_COMPARE_MODE: 0x884c,
        TEXTURE_COMPARE_FUNC: 0x884d,
        TEXTURE_MIN_LOD: 0x813a,
        TEXTURE_MAX_LOD: 0x813b,
        COMPARE_REF_TO_TEXTURE: 0x884e,
        NONE: 0,
        REPEAT: 0x2901,
        CLAMP_TO_EDGE: 0x812f,
        CLAMP_TO_BORDER: 0x812d,
        MIRRORED_REPEAT: 0x8370,
        NEAREST: 0x2600,
        LINEAR: 0x2601,
        NEAREST_MIPMAP_NEAREST: 0x2700,
        LINEAR_MIPMAP_NEAREST: 0x2701,
        NEAREST_MIPMAP_LINEAR: 0x2702,
        LINEAR_MIPMAP_LINEAR: 0x2703,
        NEVER: 0x0200,
        LESS: 0x0201,
        EQUAL: 0x0202,
        LEQUAL: 0x0203,
        GREATER: 0x0204,
        NOTEQUAL: 0x0205,
        GEQUAL: 0x0206,
        ALWAYS: 0x0207,
        createShader: vi.fn((type: number) => {
            const shader = { type };
            shaders.add(shader);
            return shader as unknown as WebGLShader;
        }),
        shaderSource: vi.fn(),
        compileShader: vi.fn(),
        getShaderParameter: vi.fn(() => true),
        getShaderInfoLog: vi.fn(() => ''),
        deleteShader: vi.fn((shader: object) => {
            shaders.delete(shader);
        }),
        createProgram: vi.fn(() => {
            const program = {};
            programs.add(program);
            return program as WebGLProgram;
        }),
        bindAttribLocation: vi.fn(),
        attachShader: vi.fn(),
        linkProgram: vi.fn(),
        getProgramParameter: vi.fn(() => true),
        getProgramInfoLog: vi.fn(() => ''),
        deleteProgram: vi.fn((program: object) => {
            programs.delete(program);
        }),
        getUniformLocation: vi.fn(
            (_: WebGLProgram, name: string) => ({ name }) as WebGLUniformLocation
        ),
        useProgram: vi.fn(),
        createVertexArray: vi.fn(() => {
            const vao = {};
            vertexArrays.add(vao);
            return vao as WebGLVertexArrayObject;
        }),
        bindVertexArray: vi.fn(),
        deleteVertexArray: vi.fn((vao: object) => {
            vertexArrays.delete(vao);
        }),
        createBuffer: vi.fn(() => {
            const buffer = {};
            buffers.add(buffer);
            return buffer as WebGLBuffer;
        }),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        deleteBuffer: vi.fn((buffer: object) => {
            buffers.delete(buffer);
        }),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        viewport: vi.fn(),
        clearColor: vi.fn(),
        clearDepth: vi.fn(),
        clear: vi.fn(),
        enable: vi.fn(),
        disable: vi.fn(),
        cullFace: vi.fn(),
        blendFunc: vi.fn(),
        depthMask: vi.fn(),
        uniformMatrix4fv: vi.fn(),
        uniform4f: vi.fn(),
        uniform3f: vi.fn(),
        uniform2f: vi.fn(),
        uniform1f: vi.fn(),
        uniform1i: vi.fn(),
        uniform4fv: vi.fn(),
        uniform3fv: vi.fn(),
        uniform2fv: vi.fn(),
        uniform1fv: vi.fn(),
        uniform4iv: vi.fn(),
        uniform3iv: vi.fn(),
        uniform2iv: vi.fn(),
        uniform1iv: vi.fn(),
        uniform4uiv: vi.fn(),
        uniform3uiv: vi.fn(),
        uniform2uiv: vi.fn(),
        uniform1uiv: vi.fn(),
        drawArrays: vi.fn(),
        drawElements: vi.fn(),
        createTexture: vi.fn(() => {
            const texture = {};
            textures.add(texture);
            return texture as WebGLTexture;
        }),
        bindTexture: vi.fn(),
        activeTexture: vi.fn(),
        deleteTexture: vi.fn((texture: object) => {
            textures.delete(texture);
        }),
        texImage2D: vi.fn(),
        texImage3D: vi.fn(),
        texSubImage2D: vi.fn(),
        texSubImage3D: vi.fn(),
        generateMipmap: vi.fn(),
        createSampler: vi.fn(() => {
            const sampler = {};
            samplers.add(sampler);
            return sampler as WebGLSampler;
        }),
        bindSampler: vi.fn(),
        deleteSampler: vi.fn((sampler: object) => {
            samplers.delete(sampler);
        }),
        samplerParameteri: vi.fn(),
        samplerParameterf: vi.fn(),
        getExtension: vi.fn(() => null),
        getParameter: vi.fn(() => 1),
    };

    return gl as unknown as WebGL2RenderingContext;
};

const createSceneOptions = (
    scheduler: ManualScheduler,
    canvas: HTMLCanvasElement,
    registry: SceneOptions<any>['registry'] = {}
): SceneOptions<any> => {
    const gl = createMockGL(canvas);
    Object.defineProperty(canvas, 'getContext', {
        value: vi.fn(() => gl),
        configurable: true,
    });

    return {
        registry,
        scheduler: scheduler as any,
        autoStart: false,
        createCanvas: () => canvas,
        width: 640,
        height: 360,
        fixedDelta: 16,
    };
};

describe('Scene', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('../../scene');
        Scene = sceneModule.Scene;
        MeshRenderer = sceneModule.MeshRenderer;
        DirectionalLight = sceneModule.DirectionalLight;
        OrbitCameraController = sceneModule.OrbitCameraController;
        PointLight = sceneModule.PointLight;
        SpotLight = sceneModule.SpotLight;
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('creates and attaches a canvas when one is not provided', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));

        expect(scene.canvas).toBe(canvas);
        expect(document.body.contains(canvas)).toBe(true);
        expect(scene.canvas.width).toBe(640);
        expect(scene.canvas.height).toBe(360);

        scene.dispose();
    });

    it('runs registered custom components through fixed, update, and late phases', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));
        scene.registerComponent(PulseComponent);

        const actor = scene.createActor({ name: 'PulseActor' });
        const component = actor.addComponent(PulseComponent);

        scene.start(0);
        scheduler.flush(16);

        expect(component.fixedCalls).toBe(1);
        expect(component.updateCalls).toBe(1);
        expect(component.lateCalls).toBe(1);

        scene.dispose();
    });

    it('binds textures, applies lighting uniforms, and renders across multiple passes', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as unknown as ReturnType<typeof createMockGL>;

        scene.registerShader({
            id: 'test/lit-textured',
            vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
void main() {
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
            fragmentSource: `#version 300 es
precision highp float;
uniform sampler2D u_MainTex;
uniform vec3 u_LightColor;
uniform vec3 u_AmbientLight;
uniform bool u_ReceiveLighting;
out vec4 o_Color;
void main() {
    vec3 base = texture(u_MainTex, vec2(0.5)).rgb;
    vec3 lit = base * (u_AmbientLight + (u_ReceiveLighting ? u_LightColor : vec3(0.0)));
    o_Color = vec4(lit, 1.0);
}`,
            uniforms: [
                'u_Model',
                'u_View',
                'u_Projection',
                'u_MainTex',
                'u_LightColor',
                'u_AmbientLight',
                'u_ReceiveLighting',
            ],
        });

        scene.registerMesh({
            id: 'triangle',
            vertices: new Float32Array([0, 0.5, -2, -0.5, -0.5, -2, 0.5, -0.5, -2]),
            attributes: [
                {
                    semantic: 'position',
                    componentCount: 3,
                    offset: 0,
                    stride: 12,
                },
            ],
            vertexCount: 3,
        });

        scene.registerSampler({
            id: 'linear-repeat',
            minFilter: 'LINEAR' as any,
            magFilter: 'LINEAR' as any,
            wrapS: 'REPEAT' as any,
            wrapT: 'REPEAT' as any,
        });

        await scene.registerTexture({
            id: 'checker',
            format: 'RGBA8' as any,
            samplerId: 'linear-repeat',
            source: {
                kind: 'checker',
                size: 4,
            },
        });

        scene.createMaterial({
            id: 'triangle-material',
            shaderId: 'test/lit-textured',
            textures: {
                u_MainTex: {
                    textureId: 'checker',
                    samplerId: 'linear-repeat',
                },
            },
        });

        scene.registerRenderPass({
            id: 'overlay',
            order: 1,
            rendererPassId: 'overlay',
            clearFlags: [],
            blend: true,
        });

        const cameraActor = scene.createCameraActor({ name: 'Camera' }, { primary: true });
        cameraActor.addComponent(OrbitCameraController, { distance: 5, azimuth: 0, elevation: 0 });

        const lightActor = scene.createActor({ name: 'Sun' });
        lightActor.addComponent(DirectionalLight, {
            color: [1, 0.9, 0.8],
            primary: true,
        });

        const mainMesh = scene.createRenderableActor(
            { name: 'MainTriangle' },
            { meshId: 'triangle', materialId: 'triangle-material', passId: 'main' }
        );
        mainMesh.requireComponent(Transform).position = new Vec3(-0.5, 0, 0);

        const overlayMesh = scene.createRenderableActor(
            { name: 'OverlayTriangle' },
            { meshId: 'triangle', materialId: 'triangle-material', passId: 'overlay' }
        );
        overlayMesh.requireComponent(Transform).position = new Vec3(0.5, 0, 0);

        scene.start(0);
        scheduler.flush(16);

        expect(gl.drawArrays).toHaveBeenCalledTimes(2);
        expect(gl.bindSampler).toHaveBeenCalled();
        expect(gl.bindTexture).toHaveBeenCalled();

        const uniform3fMock = gl.uniform3f as unknown as {
            mock: { calls: readonly [WebGLUniformLocation | null, number, number, number][] };
        };
        const lightColorCalls = uniform3fMock.mock.calls.filter(
            ([location]: readonly [WebGLUniformLocation | null, number, number, number]) =>
                (location as { name: string }).name === 'u_LightColor'
        );
        expect(lightColorCalls.length).toBeGreaterThan(0);
        expect(lightColorCalls[0].slice(1)).toEqual([1, 0.9, 0.8]);

        expect(cameraActor.requireComponent(Transform).position.z).toBeGreaterThan(0);

        scene.dispose();
    });

    it('serializes and reloads scene assets and prefab actors', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as unknown as ReturnType<typeof createMockGL>;

        scene.registerShader({
            id: 'test/solid',
            vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
void main() {
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
            fragmentSource: `#version 300 es
precision highp float;
uniform sampler2D u_MainTex;
out vec4 o_Color;
void main() {
    o_Color = texture(u_MainTex, vec2(0.5));
}`,
            uniforms: ['u_Model', 'u_View', 'u_Projection', 'u_MainTex'],
        });

        scene.createPlaneMesh('plane', 1, 1);
        await scene.registerTexture({
            id: 'solid',
            format: 'RGBA8' as any,
            source: {
                kind: 'color',
                color: [0.2, 0.6, 1, 1],
                width: 2,
                height: 2,
            },
        });

        scene.createMaterial({
            id: 'plane-material',
            shaderId: 'test/solid',
            textures: {
                u_MainTex: 'solid',
            },
        });

        const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
        const plane = scene.createRenderableActor(
            { name: 'Plane' },
            { meshId: 'plane', materialId: 'plane-material', passId: 'main' }
        );
        plane.requireComponent(Transform).position = new Vec3(0, 0, -2);
        plane.requireComponent(Transform).parent = camera.requireComponent(Transform);

        const snapshot = scene.serializeScene();
        const serializedPlane = snapshot.prefab.actors.find(
            (actor: { name: string }) => actor.name === 'Plane'
        );

        expect(snapshot.prefab.actors.length).toBe(2);
        expect(snapshot.textures.length).toBe(1);
        expect(snapshot.materials[0].textures?.u_MainTex).toBe('solid');
        expect(serializedPlane?.parentNodeId).toBe(camera.id);

        await scene.loadScene(snapshot);
        scene.renderNow();

        expect(scene.world.getAllActors().length).toBe(snapshot.prefab.actors.length);

        const restoredPlane = scene.world
            .getAllActors()
            .find((actor: { name: string }) => actor.name === 'Plane');
        const restoredCamera = scene.world
            .getAllActors()
            .find((actor: { name: string }) => actor.name === 'Camera');
        expect(restoredPlane).toBeDefined();
        expect(restoredPlane?.getComponent(MeshRenderer)?.materialId).toBe('plane-material');
        expect(restoredPlane?.requireComponent(Transform).parent?.id).toBe(
            restoredCamera?.requireComponent(Transform).id
        );
        expect(scene.getTexture('solid')?.width).toBe(2);
        expect(gl.drawElements).toHaveBeenCalled();

        scene.dispose();
    });

    it('hydrates prefab components after restoring parent links', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(
            createSceneOptions(scheduler, canvas, {
                ParentAwareComponent,
            })
        );

        const parent = scene.createActor({ name: 'Parent' });
        const child = scene.createActor({ name: 'Child' });
        child.setParent(parent);
        child.addComponent(ParentAwareComponent);

        const prefab = scene.createPrefab('hierarchy-aware', [parent, child]);
        const instantiated = scene.instantiatePrefab(prefab, {
            namePrefix: 'Copy ',
        });
        const restoredChild = instantiated.find((actor) => actor.name === 'Copy Child');
        const restoredComponent = restoredChild?.getComponent(ParentAwareComponent);

        expect(restoredChild?.parent?.name).toBe('Copy Parent');
        expect(restoredComponent?.parentNameAtAwake).toBe('Copy Parent');

        scene.dispose();
    });

    it('uploads point and spot light arrays for shaders that declare local light uniforms', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as unknown as ReturnType<typeof createMockGL>;

        scene.registerShader({
            id: 'test/local-lights',
            vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
void main() {
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
            fragmentSource: `#version 300 es
precision highp float;
uniform bool u_ReceiveLighting;
uniform int u_PointLightCount;
uniform int u_SpotLightCount;
uniform int u_LocalLightCount;
uniform int u_LocalLightType[4];
uniform vec3 u_LocalLightPosition[4];
uniform vec3 u_LocalLightDirection[4];
uniform vec3 u_LocalLightColor[4];
uniform float u_LocalLightIntensity[4];
uniform float u_LocalLightRange[4];
uniform float u_LocalLightInnerCone[4];
uniform float u_LocalLightOuterCone[4];
out vec4 o_Color;
void main() {
    float intensity = u_ReceiveLighting ? float(u_LocalLightCount) : 0.0;
    o_Color = vec4(intensity / 4.0, 0.0, 0.0, 1.0);
}`,
            uniforms: [
                'u_Model',
                'u_View',
                'u_Projection',
                'u_ReceiveLighting',
                'u_PointLightCount',
                'u_SpotLightCount',
                'u_LocalLightCount',
                'u_LocalLightType',
                'u_LocalLightPosition',
                'u_LocalLightDirection',
                'u_LocalLightColor',
                'u_LocalLightIntensity',
                'u_LocalLightRange',
                'u_LocalLightInnerCone',
                'u_LocalLightOuterCone',
            ],
        });

        scene.createPlaneMesh('plane', 1, 1);
        scene.createMaterial({
            id: 'plane-material',
            shaderId: 'test/local-lights',
        });

        scene.createCameraActor({ name: 'Camera' }, { primary: true });
        const pointActor = scene.createActor({ name: 'Point' });
        pointActor.addComponent(SpotLight, {
            color: [0.8, 0.7, 0.6],
            intensity: 4,
            range: 12,
            innerConeAngle: 0.2,
            outerConeAngle: 0.6,
        });
        pointActor.requireComponent(Transform).position = new Vec3(2, 3, 4);

        const spotActor = scene.createActor({ name: 'Spot' });
        spotActor.addComponent(SpotLight, {
            color: [0.2, 0.4, 1],
            intensity: 8,
            range: 18,
            innerConeAngle: 0.15,
            outerConeAngle: 0.5,
        });
        spotActor.requireComponent(Transform).position = new Vec3(-1, 5, 2);

        const pointLightActor = scene.createActor({ name: 'PointLight' });
        pointLightActor.addComponent(PointLight, {
            color: [1, 0.5, 0.25],
            intensity: 3,
            range: 9,
        });
        pointLightActor.requireComponent(Transform).position = new Vec3(1, 2, 3);

        const plane = scene.createRenderableActor(
            { name: 'Plane' },
            { meshId: 'plane', materialId: 'plane-material', passId: 'main' }
        );
        plane.requireComponent(Transform).position = new Vec3(0, 0, -2);

        scene.start(0);
        scheduler.flush(16);

        const uniform1iMock = gl.uniform1i as unknown as {
            mock: { calls: readonly [WebGLUniformLocation | null, number][] };
        };
        const uniform3fvMock = gl.uniform3fv as unknown as {
            mock: { calls: readonly [WebGLUniformLocation | null, Float32Array][] };
        };
        const uniform1ivMock = gl.uniform1iv as unknown as {
            mock: { calls: readonly [WebGLUniformLocation | null, Int32Array][] };
        };
        const uniform1fvMock = gl.uniform1fv as unknown as {
            mock: { calls: readonly [WebGLUniformLocation | null, Float32Array][] };
        };

        const localLightCountCall = uniform1iMock.mock.calls.find(
            ([location]) => (location as { name: string }).name === 'u_LocalLightCount'
        );
        const spotLightCountCall = uniform1iMock.mock.calls.find(
            ([location]) => (location as { name: string }).name === 'u_SpotLightCount'
        );
        const localLightTypesCall = uniform1ivMock.mock.calls.find(
            ([location]) => (location as { name: string }).name === 'u_LocalLightType'
        );
        const localLightPositionsCall = uniform3fvMock.mock.calls.find(
            ([location]) => (location as { name: string }).name === 'u_LocalLightPosition'
        );
        const localLightOuterConesCall = uniform1fvMock.mock.calls.find(
            ([location]) => (location as { name: string }).name === 'u_LocalLightOuterCone'
        );

        expect(localLightCountCall?.[1]).toBe(3);
        expect(spotLightCountCall?.[1]).toBe(2);
        expect(localLightTypesCall?.[1]).toEqual(new Int32Array([1, 1, 0]));
        expect(localLightPositionsCall?.[1]).toEqual(
            new Float32Array([2, 3, 4, -1, 5, 2, 1, 2, 3])
        );
        expect(localLightOuterConesCall?.[1]).toEqual(new Float32Array([0.6, 0.5, 0]));

        scene.dispose();
    });
});
