import { Mat4, Vec3 } from '@axrone/numeric';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component } from '../../component-system/core/component';
import { Transform } from '../../component-system/components/transform';
import { TextureFormat } from '../../renderer/webgl2/texture/interfaces';
import {
    createMockGL,
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from './test-harness';

let Scene: typeof import('../../scene').Scene;
let Animator: typeof import('../../scene').Animator;
let Camera: typeof import('../../scene').Camera;
let MeshRenderer: typeof import('../../scene').MeshRenderer;
let DirectionalLight: typeof import('../../scene').DirectionalLight;
let OrbitCameraController: typeof import('../../scene').OrbitCameraController;
let PrefabNodeBinding: typeof import('../../scene').PrefabNodeBinding;
let PointLight: typeof import('../../scene').PointLight;
let SpotLight: typeof import('../../scene').SpotLight;

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

describe('Scene', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('../../scene');
        Scene = sceneModule.Scene;
        Animator = sceneModule.Animator;
        Camera = sceneModule.Camera;
        MeshRenderer = sceneModule.MeshRenderer;
        DirectionalLight = sceneModule.DirectionalLight;
        OrbitCameraController = sceneModule.OrbitCameraController;
        PrefabNodeBinding = sceneModule.PrefabNodeBinding;
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

    it('decodes bytes-backed texture sources before registering GPU textures', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));
        const decodedSurface = document.createElement('canvas');
        Object.defineProperty(decodedSurface, 'width', { value: 2, configurable: true });
        Object.defineProperty(decodedSurface, 'height', { value: 3, configurable: true });
        const loadImageFromBytes = (scene as unknown as {
            _loadImageFromBytes: (
                bytes: readonly number[] | Uint8Array,
                mimeType: string,
                uri?: string
            ) => Promise<HTMLImageElement>;
        })._loadImageFromBytes;

        (scene as unknown as {
            _loadImageFromBytes: (
                bytes: readonly number[] | Uint8Array,
                mimeType: string,
                uri?: string
            ) => Promise<HTMLImageElement | HTMLCanvasElement>;
        })._loadImageFromBytes = async (bytes, mimeType, uri) => {
            expect(bytes).toEqual(new Uint8Array([137, 80, 78, 71]));
            expect(mimeType).toBe('image/png');
            expect(uri).toBe('textures/albedo.png');
            return decodedSurface;
        };

        try {
            const texture = await scene.registerTexture({
                id: 'bytes-texture',
                source: {
                    kind: 'bytes',
                    bytes: new Uint8Array([137, 80, 78, 71]),
                    mimeType: 'image/png',
                    uri: 'textures/albedo.png',
                },
            });

            expect(texture.width).toBe(2);
            expect(texture.height).toBe(3);
        } finally {
            (scene as unknown as { _loadImageFromBytes: typeof loadImageFromBytes })._loadImageFromBytes =
                loadImageFromBytes;
            scene.dispose();
        }
    });

    it('uploads compressed texture mip chains when runtime-ready blocks are provided', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as unknown as ReturnType<typeof createMockGL>;
        const getExtension = gl.getExtension;

        gl.getExtension = vi.fn((name: string) =>
            name === 'WEBGL_compressed_texture_astc' ? {} : null
        ) as typeof gl.getExtension;
        (gl.compressedTexImage2D as unknown as { mockClear: () => void }).mockClear();
        (gl.generateMipmap as unknown as { mockClear: () => void }).mockClear();

        try {
            const texture = await scene.registerTexture({
                id: 'compressed-texture',
                format: TextureFormat.ASTC_4x4,
                generateMipmaps: false,
                source: {
                    kind: 'compressed',
                    bytes: new Uint8Array([
                        1, 2, 3, 4, 5, 6, 7, 8,
                        9, 10, 11, 12, 13, 14, 15, 16,
                        17, 18, 19, 20, 21, 22, 23, 24,
                        25, 26, 27, 28, 29, 30, 31, 32,
                    ]),
                    container: 'ktx2',
                    levels: [
                        {
                            level: 0,
                            width: 4,
                            height: 4,
                            byteOffset: 0,
                            byteLength: 16,
                        },
                        {
                            level: 1,
                            width: 2,
                            height: 2,
                            byteOffset: 16,
                            byteLength: 16,
                        },
                    ],
                },
            });

            expect(texture.width).toBe(4);
            expect(texture.height).toBe(4);
            expect(gl.compressedTexImage2D).toHaveBeenCalledTimes(2);
            expect(gl.compressedTexImage2D).toHaveBeenNthCalledWith(
                1,
                expect.any(Number),
                0,
                0x93b0,
                4,
                4,
                0,
                expect.any(Uint8Array)
            );
            expect(gl.compressedTexImage2D).toHaveBeenNthCalledWith(
                2,
                expect.any(Number),
                1,
                0x93b0,
                2,
                2,
                0,
                expect.any(Uint8Array)
            );
            expect(gl.generateMipmap).not.toHaveBeenCalled();
        } finally {
            gl.getExtension = getExtension;
            scene.dispose();
        }
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

    it('builds a stable view matrix even when camera scale is zero', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));
        const cameraActor = scene.createCameraActor({ name: 'Camera' }, { primary: true });
        const transform = cameraActor.requireComponent(Transform);
        const camera = cameraActor.getComponent(Camera);

        transform.position = new Vec3(2, 3, 4);
        transform.rotateEuler(0.1, 0.25, 0);
        transform.scale = new Vec3(0, 0, 0);

        const expected = Mat4.multiply(
            Mat4.fromQuaternion(transform.worldRotation.clone().inverse()),
            Mat4.translate(new Vec3(-2, -3, -4))
        );

        expect(camera).toBeDefined();
        expect(() => camera!.getViewMatrix()).not.toThrow();
        expect(camera!.getViewMatrix().toArray()).toEqual(expected.toArray());

        scene.dispose();
    });

    it('clamps orbit camera distance before computing look-at transforms', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));
        const cameraActor = scene.createCameraActor({ name: 'Camera' }, { primary: true });
        const transform = cameraActor.requireComponent(Transform);

        cameraActor.addComponent(OrbitCameraController, {
            distance: 0,
            minDistance: 0,
            maxDistance: 2,
            azimuth: 0.2,
            elevation: 0.1,
        });

        scene.start(0);

        expect(() => scheduler.flush(16)).not.toThrow();
        expect(transform.position.length()).toBeGreaterThan(0);

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

    it('animates prefab-scoped nodes without leaking across instances', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));

        const templateRoot = scene.createActor({ name: 'AnimatedRoot' });
        templateRoot.addComponent(PrefabNodeBinding, { nodeId: 'node/0' });
        templateRoot.addComponent(Animator, {
            clips: [
                {
                    id: 'Move',
                    duration: 1,
                    tracks: [
                        {
                            targetNodeId: 'node/1',
                            path: 'translation',
                            interpolation: 'LINEAR',
                            keyframeCount: 2,
                            valueComponentCount: 3,
                            sampleStride: 3,
                            times: new Float32Array([0, 1]),
                            values: new Float32Array([0, 0, 0, 2, 0, 0]),
                        },
                    ],
                },
            ],
            clipId: 'Move',
            playOnStart: true,
            playing: true,
            loop: false,
        });

        const templateChild = scene.createActor({ name: 'AnimatedChild' });
        templateChild.addComponent(PrefabNodeBinding, { nodeId: 'node/1' });
        templateChild.setParent(templateRoot);

        const prefab = scene.createPrefab('animated-prefab', [templateRoot, templateChild]);
        templateChild.destroy(true);
        templateRoot.destroy(true);

        const firstInstance = scene.instantiatePrefab(prefab, { namePrefix: 'A ' });
        const secondInstance = scene.instantiatePrefab(prefab, { namePrefix: 'B ' });

        const firstChild = firstInstance.find((actor) => actor.name === 'A AnimatedChild');
        const secondRoot = secondInstance.find((actor) => actor.name === 'B AnimatedRoot');
        const secondChild = secondInstance.find((actor) => actor.name === 'B AnimatedChild');

        secondRoot?.requireComponent(Animator).pause();

        scene.start(0);
        scheduler.flush(250);
        scheduler.flush(500);
        scheduler.flush(750);
        scheduler.flush(1000);

        expect(firstChild?.requireComponent(Transform).position.x).toBeCloseTo(2, 5);
        expect(secondChild?.requireComponent(Transform).position.x).toBeCloseTo(0, 5);

        scene.dispose();
    });

    it('animates prefab-scoped morph weights without leaking across instances', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));

        const templateRoot = scene.createActor({ name: 'MorphRoot' });
        templateRoot.addComponent(PrefabNodeBinding, { nodeId: 'node/0' });
        templateRoot.addComponent(Animator, {
            clips: [
                {
                    id: 'Morph',
                    duration: 1,
                    tracks: [
                        {
                            targetNodeId: 'node/1',
                            path: 'weights',
                            interpolation: 'LINEAR',
                            keyframeCount: 2,
                            valueComponentCount: 1,
                            sampleStride: 1,
                            times: new Float32Array([0, 1]),
                            values: new Float32Array([0, 1]),
                        },
                    ],
                },
            ],
            clipId: 'Morph',
            playOnStart: true,
            playing: true,
            loop: false,
        });

        const templateChild = scene.createActor({ name: 'MorphChild' });
        templateChild.addComponent(PrefabNodeBinding, { nodeId: 'node/1' });
        templateChild.addComponent(MeshRenderer, {
            morph: {
                weights: new Float32Array([0]),
            },
        });
        templateChild.setParent(templateRoot);

        const prefab = scene.createPrefab('morph-prefab', [templateRoot, templateChild]);
        templateChild.destroy(true);
        templateRoot.destroy(true);

        const firstInstance = scene.instantiatePrefab(prefab, { namePrefix: 'A ' });
        const secondInstance = scene.instantiatePrefab(prefab, { namePrefix: 'B ' });

        const firstChild = firstInstance.find((actor) => actor.name === 'A MorphChild');
        const secondRoot = secondInstance.find((actor) => actor.name === 'B MorphRoot');
        const secondChild = secondInstance.find((actor) => actor.name === 'B MorphChild');

        secondRoot?.requireComponent(Animator).pause();

        scene.start(0);
        scheduler.flush(250);
        scheduler.flush(500);

        expect(firstChild?.requireComponent(MeshRenderer).morphWeights?.[0]).toBeCloseTo(0.5, 5);
        expect(secondChild?.requireComponent(MeshRenderer).morphWeights?.[0]).toBeCloseTo(0, 5);

        scene.dispose();
    });

    it('uploads joint palettes and integer joint attributes for skinned meshes', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as unknown as ReturnType<typeof createMockGL>;

        scene.registerShader({
            id: 'test/skinned',
            vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 9) in uvec4 a_Joints0;
layout(location = 10) in vec4 a_Weights0;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
uniform bool u_Skinning;
uniform int u_SkinJointCount;
uniform mat4 u_JointMatrices[1];
void main() {
    vec4 localPosition = vec4(a_Position, 1.0);
    if (u_Skinning && u_SkinJointCount > 0) {
        localPosition = (u_JointMatrices[int(a_Joints0.x)] * localPosition) * a_Weights0.x;
    }
    gl_Position = u_Projection * u_View * u_Model * localPosition;
}`,
            fragmentSource: `#version 300 es
precision highp float;
out vec4 o_Color;
void main() {
    o_Color = vec4(1.0);
}`,
            uniforms: [
                'u_Model',
                'u_View',
                'u_Projection',
                'u_Skinning',
                'u_SkinJointCount',
                'u_JointMatrices',
            ],
        });

        const stride = 36;
        const vertices = new Uint8Array(stride * 3);
        const vertexView = new DataView(vertices.buffer);
        const positions = [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
        ] as const;

        for (let vertex = 0; vertex < positions.length; vertex += 1) {
            const baseOffset = vertex * stride;
            vertexView.setFloat32(baseOffset, positions[vertex]![0], true);
            vertexView.setFloat32(baseOffset + 4, positions[vertex]![1], true);
            vertexView.setFloat32(baseOffset + 8, positions[vertex]![2], true);
            vertexView.setUint16(baseOffset + 12, 0, true);
            vertexView.setUint16(baseOffset + 14, 0, true);
            vertexView.setUint16(baseOffset + 16, 0, true);
            vertexView.setUint16(baseOffset + 18, 0, true);
            vertexView.setFloat32(baseOffset + 20, 1, true);
            vertexView.setFloat32(baseOffset + 24, 0, true);
            vertexView.setFloat32(baseOffset + 28, 0, true);
            vertexView.setFloat32(baseOffset + 32, 0, true);
        }

        scene.registerMesh({
            id: 'skinned-triangle',
            vertices,
            indices: new Uint16Array([0, 1, 2]),
            vertexCount: 3,
            attributes: [
                {
                    semantic: 'position',
                    componentCount: 3,
                    offset: 0,
                    stride,
                    type: gl.FLOAT,
                },
                {
                    semantic: 'joints0',
                    componentCount: 4,
                    offset: 12,
                    stride,
                    type: gl.UNSIGNED_SHORT,
                    integer: true,
                },
                {
                    semantic: 'weights0',
                    componentCount: 4,
                    offset: 20,
                    stride,
                    type: gl.FLOAT,
                },
            ],
        });

        scene.createMaterial({
            id: 'skinned-material',
            shaderId: 'test/skinned',
        });

        const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
        camera.requireComponent(Transform).position = new Vec3(0, 0, 5);

        const rigRoot = scene.createActor({ name: 'RigRoot' });
        rigRoot.addComponent(PrefabNodeBinding, {
            nodeId: 'node/0',
            instanceId: 'skin-instance',
        });

        const joint = scene.createActor({ name: 'Joint' });
        joint.addComponent(PrefabNodeBinding, {
            nodeId: 'node/1',
            instanceId: 'skin-instance',
        });
        joint.setParent(rigRoot);
        joint.requireComponent(Transform).position = new Vec3(0, 1, 0);

        const meshActor = scene.createRenderableActor(
            { name: 'SkinnedMesh' },
            {
                meshId: 'skinned-triangle',
                materialId: 'skinned-material',
                skin: {
                    jointNodeIds: ['node/1'],
                    inverseBindMatrices: new Float32Array([
                        1, 0, 0, 0,
                        0, 1, 0, 0,
                        0, 0, 1, 0,
                        0, 0, 0, 1,
                    ]),
                },
            }
        );
        meshActor.addComponent(PrefabNodeBinding, {
            nodeId: 'node/2',
            instanceId: 'skin-instance',
        });
        meshActor.setParent(rigRoot);
        meshActor.requireComponent(Transform).position = new Vec3(0, 0, -2);

        scene.start(0);
        scheduler.flush(16);

        expect(gl.vertexAttribIPointer).toHaveBeenCalledWith(9, 4, gl.UNSIGNED_SHORT, stride, 12);

        const uniform1iMock = gl.uniform1i as unknown as {
            mock: { calls: readonly [WebGLUniformLocation | null, number][] };
        };
        const skinningCall = uniform1iMock.mock.calls.find(
            ([location]) => (location as { name: string }).name === 'u_Skinning'
        );
        const jointCountCall = uniform1iMock.mock.calls.find(
            ([location]) => (location as { name: string }).name === 'u_SkinJointCount'
        );
        const jointPaletteCall = (gl.uniformMatrix4fv as unknown as {
            mock: { calls: readonly [WebGLUniformLocation | null, boolean, Float32Array][] };
        }).mock.calls.find(
            ([location]) => (location as { name: string }).name === 'u_JointMatrices'
        );

        expect(skinningCall?.[1]).toBe(1);
        expect(jointCountCall?.[1]).toBe(1);
        expect(jointPaletteCall?.[2].length).toBe(16);
        expect(jointPaletteCall?.[2].some((value, index) => ![0, 5, 10, 15].includes(index) && value !== 0)).toBe(true);
        expect(gl.drawElements).toHaveBeenCalled();

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
