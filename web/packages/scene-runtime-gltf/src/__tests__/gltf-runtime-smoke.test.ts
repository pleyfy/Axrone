import { Vec3 } from '@axrone/numeric';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    AssetDatabase,
} from '@axrone/asset-core';
import {
    createGltfImporter,
    type GltfAssetSchema,
    type GltfRootJson,
} from '@axrone/asset-gltf';
import { loadGltfSceneIntoScene } from '@axrone/scene-runtime-gltf';
import { Transform } from '@axrone/ecs-runtime';
import {
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
    type MockGLContext,
} from '../../../scene-3d/src/__tests__/test-harness';

const trianglePositions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const triangleIndices = new Uint16Array([0, 1, 2]);

let Scene: typeof import('@axrone/scene-3d').Scene;
let Animator: typeof import('@axrone/scene-3d').Animator;
let MeshRenderer: typeof import('@axrone/scene-3d').MeshRenderer;

const createGlb = (json: GltfRootJson, bin: Uint8Array): Uint8Array => {
    const encoder = new TextEncoder();
    const jsonBytes = encoder.encode(JSON.stringify(json));
    const jsonPadding = (4 - (jsonBytes.byteLength % 4)) % 4;
    const paddedJson = new Uint8Array(jsonBytes.byteLength + jsonPadding);
    paddedJson.set(jsonBytes);
    paddedJson.fill(0x20, jsonBytes.byteLength);

    const binPadding = (4 - (bin.byteLength % 4)) % 4;
    const paddedBin = new Uint8Array(bin.byteLength + binPadding);
    paddedBin.set(bin);

    const totalLength = 12 + 8 + paddedJson.byteLength + 8 + paddedBin.byteLength;
    const glb = new Uint8Array(totalLength);
    const view = new DataView(glb.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, totalLength, true);
    view.setUint32(12, paddedJson.byteLength, true);
    view.setUint32(16, 0x4e4f534a, true);
    glb.set(paddedJson, 20);
    const binHeaderOffset = 20 + paddedJson.byteLength;
    view.setUint32(binHeaderOffset, paddedBin.byteLength, true);
    view.setUint32(binHeaderOffset + 4, 0x004e4942, true);
    glb.set(paddedBin, binHeaderOffset + 8);
    return glb;
};

const createRigBinaryBlob = (): Uint8Array => {
    const jointIndices = new Uint16Array([
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
    ]);
    const jointWeights = new Float32Array([
        1, 0, 0, 0,
        1, 0, 0, 0,
        1, 0, 0, 0,
    ]);
    const inverseBindMatrices = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ]);
    const animationTimes = new Float32Array([0, 1]);
    const animationTranslations = new Float32Array([
        0, 0, 0,
        1, 0, 0,
    ]);
    const total =
        trianglePositions.byteLength +
        jointIndices.byteLength +
        jointWeights.byteLength +
        triangleIndices.byteLength +
        2 +
        inverseBindMatrices.byteLength +
        animationTimes.byteLength +
        animationTranslations.byteLength;
    const bytes = new Uint8Array(total);
    let offset = 0;
    bytes.set(new Uint8Array(trianglePositions.buffer), offset);
    offset += trianglePositions.byteLength;
    bytes.set(new Uint8Array(jointIndices.buffer), offset);
    offset += jointIndices.byteLength;
    bytes.set(new Uint8Array(jointWeights.buffer), offset);
    offset += jointWeights.byteLength;
    bytes.set(new Uint8Array(triangleIndices.buffer), offset);
    offset += triangleIndices.byteLength + 2;
    bytes.set(new Uint8Array(inverseBindMatrices.buffer), offset);
    offset += inverseBindMatrices.byteLength;
    bytes.set(new Uint8Array(animationTimes.buffer), offset);
    offset += animationTimes.byteLength;
    bytes.set(new Uint8Array(animationTranslations.buffer), offset);
    return bytes;
};

const createRigJson = (): GltfRootJson => ({
    asset: {
        version: '2.0',
        generator: 'vitest',
    },
    buffers: [
        {
            byteLength: 212,
        },
    ],
    bufferViews: [
        {
            buffer: 0,
            byteOffset: 0,
            byteLength: 36,
        },
        {
            buffer: 0,
            byteOffset: 36,
            byteLength: 24,
        },
        {
            buffer: 0,
            byteOffset: 60,
            byteLength: 48,
        },
        {
            buffer: 0,
            byteOffset: 108,
            byteLength: 6,
        },
        {
            buffer: 0,
            byteOffset: 116,
            byteLength: 64,
        },
        {
            buffer: 0,
            byteOffset: 180,
            byteLength: 8,
        },
        {
            buffer: 0,
            byteOffset: 188,
            byteLength: 24,
        },
    ],
    accessors: [
        {
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: 'VEC3',
            min: [0, 0, 0],
            max: [1, 1, 0],
        },
        {
            bufferView: 1,
            componentType: 5123,
            count: 3,
            type: 'VEC4',
        },
        {
            bufferView: 2,
            componentType: 5126,
            count: 3,
            type: 'VEC4',
        },
        {
            bufferView: 3,
            componentType: 5123,
            count: 3,
            type: 'SCALAR',
        },
        {
            bufferView: 4,
            componentType: 5126,
            count: 1,
            type: 'MAT4',
        },
        {
            bufferView: 5,
            componentType: 5126,
            count: 2,
            type: 'SCALAR',
            min: [0],
            max: [1],
        },
        {
            bufferView: 6,
            componentType: 5126,
            count: 2,
            type: 'VEC3',
        },
    ],
    meshes: [
        {
            name: 'Triangle',
            primitives: [
                {
                    attributes: {
                        POSITION: 0,
                        JOINTS_0: 1,
                        WEIGHTS_0: 2,
                    },
                    indices: 3,
                },
            ],
        },
    ],
    nodes: [
        {
            name: 'Joint Root',
        },
        {
            name: 'Mesh Root',
            mesh: 0,
            skin: 0,
        },
    ],
    skins: [
        {
            inverseBindMatrices: 4,
            skeleton: 0,
            joints: [0],
            name: 'Rig',
        },
    ],
    animations: [
        {
            name: 'Move',
            samplers: [
                {
                    input: 5,
                    output: 6,
                },
            ],
            channels: [
                {
                    sampler: 0,
                    target: {
                        node: 1,
                        path: 'translation',
                    },
                },
            ],
        },
    ],
    scenes: [
        {
            name: 'Main',
            nodes: [0, 1],
        },
    ],
    scene: 0,
});

const createMorphBinaryBlob = (): Uint8Array => {
    const morphPositions = new Float32Array([
        1, 0, 0,
        0, 0, 0,
        0, 0, 0,
    ]);
    const animationTimes = new Float32Array([0, 1]);
    const animationWeights = new Float32Array([0, 1]);
    const total =
        trianglePositions.byteLength +
        morphPositions.byteLength +
        triangleIndices.byteLength +
        2 +
        animationTimes.byteLength +
        animationWeights.byteLength;
    const bytes = new Uint8Array(total);
    let offset = 0;
    bytes.set(new Uint8Array(trianglePositions.buffer), offset);
    offset += trianglePositions.byteLength;
    bytes.set(new Uint8Array(morphPositions.buffer), offset);
    offset += morphPositions.byteLength;
    bytes.set(new Uint8Array(triangleIndices.buffer), offset);
    offset += triangleIndices.byteLength + 2;
    bytes.set(new Uint8Array(animationTimes.buffer), offset);
    offset += animationTimes.byteLength;
    bytes.set(new Uint8Array(animationWeights.buffer), offset);
    return bytes;
};

const createMorphJson = (): GltfRootJson => ({
    asset: {
        version: '2.0',
        generator: 'vitest',
    },
    buffers: [
        {
            byteLength: 96,
        },
    ],
    bufferViews: [
        {
            buffer: 0,
            byteOffset: 0,
            byteLength: 36,
        },
        {
            buffer: 0,
            byteOffset: 36,
            byteLength: 36,
        },
        {
            buffer: 0,
            byteOffset: 72,
            byteLength: 6,
        },
        {
            buffer: 0,
            byteOffset: 80,
            byteLength: 8,
        },
        {
            buffer: 0,
            byteOffset: 88,
            byteLength: 8,
        },
    ],
    accessors: [
        {
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: 'VEC3',
            min: [0, 0, 0],
            max: [1, 1, 0],
        },
        {
            bufferView: 1,
            componentType: 5126,
            count: 3,
            type: 'VEC3',
        },
        {
            bufferView: 2,
            componentType: 5123,
            count: 3,
            type: 'SCALAR',
        },
        {
            bufferView: 3,
            componentType: 5126,
            count: 2,
            type: 'SCALAR',
            min: [0],
            max: [1],
        },
        {
            bufferView: 4,
            componentType: 5126,
            count: 2,
            type: 'SCALAR',
        },
    ],
    meshes: [
        {
            name: 'Morph Triangle',
            weights: [0.25],
            primitives: [
                {
                    attributes: {
                        POSITION: 0,
                    },
                    indices: 2,
                    targets: [
                        {
                            POSITION: 1,
                        },
                    ],
                },
            ],
        },
    ],
    nodes: [
        {
            name: 'Morph Root',
            mesh: 0,
            weights: [0.5],
        },
    ],
    animations: [
        {
            name: 'Morph',
            samplers: [
                {
                    input: 3,
                    output: 4,
                },
            ],
            channels: [
                {
                    sampler: 0,
                    target: {
                        node: 0,
                        path: 'weights',
                    },
                },
            ],
        },
    ],
    scenes: [
        {
            name: 'Main',
            nodes: [0],
        },
    ],
    scene: 0,
});

describe('glTF runtime smoke', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('@axrone/scene-3d');
        Scene = sceneModule.Scene;
        Animator = sceneModule.Animator;
        MeshRenderer = sceneModule.MeshRenderer;
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('imports rigged glTF prefabs into the scene runtime and renders animated skinned instances', async () => {
        const database = new AssetDatabase<GltfAssetSchema>({
            importers: [createGltfImporter()],
        });
        const receipt = await database.import({
            kind: 'bytes',
            data: createGlb(createRigJson(), createRigBinaryBlob()),
            uri: 'models/rig.glb',
            mimeType: 'model/gltf-binary',
        });

        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as unknown as MockGLContext;

        try {
            const firstLoad = await loadGltfSceneIntoScene(scene, database, receipt.primary.reference, {
                namePrefix: 'A ',
            });
            const secondInstance = scene.instantiatePrefab(firstLoad.prefab.data.definition, { namePrefix: 'B ' });
            const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
            camera.requireComponent(Transform).position = new Vec3(0, 0, 5);

            const firstRootActor = firstLoad.actors.find((actor) => actor.name === 'A Joint Root');
            const firstMeshActor = firstLoad.actors.find((actor) => actor.name === 'A Mesh Root');
            const secondRootActor = secondInstance.find((actor) => actor.name === 'B Joint Root');
            const secondMeshActor = secondInstance.find((actor) => actor.name === 'B Mesh Root');
            const firstAnimator = firstRootActor?.getComponent(Animator) ?? null;

            expect(firstLoad.snapshot.materials[0]?.shaderId).toBe('gltf/pbr');
            expect(firstMeshActor?.getComponent(MeshRenderer)?.skin).toMatchObject({
                jointNodeIds: ['node/0'],
                skeletonNodeId: 'node/0',
            });
            expect(firstMeshActor?.getComponent(MeshRenderer)?.materialId).toBe(firstLoad.prefab.data.materialKeys[0]);

            expect(firstAnimator?.clipId).toBe('Move');
            expect(firstAnimator?.serialize()).toMatchObject({
                clips: [
                    {
                        id: 'Move',
                        tracks: [
                            expect.objectContaining({
                                targetNodeId: 'node/1',
                                keyframeCount: 2,
                            }),
                        ],
                    },
                ],
            });
            firstAnimator?.seek(0.75);
            expect(firstMeshActor?.requireComponent(Transform).position.x).toBeCloseTo(0.75, 5);
            firstAnimator?.seek(0);
            firstAnimator?.play();

            secondRootActor?.requireComponent(Animator).pause();

            scene.start(0);
            scheduler.flush(250);
            scheduler.flush(500);
            scheduler.flush(750);

            expect(firstMeshActor?.requireComponent(Transform).position.x).toBeCloseTo(0.75, 5);
            expect(secondMeshActor?.requireComponent(Transform).position.x).toBeCloseTo(0, 5);

            scheduler.flush(1000);

            expect(firstMeshActor?.requireComponent(Transform).position.x).toBeCloseTo(0, 5);
            expect(gl.vertexAttribIPointer).toHaveBeenCalledWith(9, 4, gl.UNSIGNED_SHORT, 36, 12);

            const skinningCall = (gl.uniform1i as unknown as {
                mock: { calls: readonly [WebGLUniformLocation | null, number][] };
            }).mock.calls.find(
                ([location]) => (location as { name: string }).name === 'u_Skinning'
            );
            const jointPaletteCall = (gl.uniformMatrix4fv as unknown as {
                mock: { calls: readonly [WebGLUniformLocation | null, boolean, Float32Array][] };
            }).mock.calls.find(
                ([location]) => (location as { name: string }).name === 'u_JointMatrices'
            );

            expect(skinningCall?.[1]).toBe(1);
            expect(jointPaletteCall?.[2].length).toBe(16);
            expect((gl.drawElements as unknown as { mock: { calls: readonly unknown[][] } }).mock.calls.length).toBeGreaterThan(0);
        } finally {
            scene.dispose();
        }
    });

    it('imports morph-target glTF prefabs into the scene runtime and uploads morphed vertices', async () => {
        const database = new AssetDatabase<GltfAssetSchema>({
            importers: [createGltfImporter()],
        });
        const receipt = await database.import({
            kind: 'bytes',
            data: createGlb(createMorphJson(), createMorphBinaryBlob()),
            uri: 'models/morph.glb',
            mimeType: 'model/gltf-binary',
        });

        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as unknown as MockGLContext;

        try {
            const load = await loadGltfSceneIntoScene(scene, database, receipt.primary.reference);
            const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
            camera.requireComponent(Transform).position = new Vec3(0, 0, 5);

            const rootActor = load.actors.find((actor) => actor.name === 'Morph Root');
            const renderer = rootActor?.getComponent(MeshRenderer) ?? null;
            const animator = rootActor?.getComponent(Animator) ?? null;

            expect(renderer?.morphWeights).toEqual(new Float32Array([0]));
            expect(animator?.clipId).toBe('Morph');

            animator?.seek(0.5);
            scene.renderNow();

            const firstMorphUpload = (gl.bufferData as unknown as {
                mock: { calls: readonly [number, Uint8Array, number][] };
            }).mock.calls.find(
                ([target, _data, usage], index) =>
                    index > 0 && target === gl.ARRAY_BUFFER && usage === gl.DYNAMIC_DRAW
            );
            const firstUploadView = firstMorphUpload
                ? new DataView(
                      firstMorphUpload[1].buffer,
                      firstMorphUpload[1].byteOffset,
                      firstMorphUpload[1].byteLength
                  )
                : null;

            expect(renderer?.morphWeights?.[0]).toBeCloseTo(0.5, 5);
            expect(firstUploadView?.getFloat32(0, true)).toBeCloseTo(0.5, 5);

            if (animator) {
                animator.loop = false;
            }
            animator?.seek(1);
            scene.renderNow();

            const bufferDataCalls = (gl.bufferData as unknown as {
                mock: { calls: readonly [number, Uint8Array, number][] };
            }).mock.calls;
            const latestMorphUpload = [...bufferDataCalls]
                .reverse()
                .find(
                    ([target, _data, usage]) =>
                        target === gl.ARRAY_BUFFER && usage === gl.DYNAMIC_DRAW
                );
            const latestUploadView = latestMorphUpload
                ? new DataView(
                      latestMorphUpload[1].buffer,
                      latestMorphUpload[1].byteOffset,
                      latestMorphUpload[1].byteLength
                  )
                : null;

            expect(renderer?.morphWeights?.[0]).toBeCloseTo(1, 5);
            expect(latestUploadView?.getFloat32(0, true)).toBeCloseTo(1, 5);
            expect((gl.drawElements as unknown as { mock: { calls: readonly unknown[][] } }).mock.calls.length).toBeGreaterThan(0);
        } finally {
            scene.dispose();
        }
    });
});
