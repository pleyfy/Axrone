import { Vec3 } from '@axrone/numeric';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    AssetDatabase,
    createGltfImporter,
    type GltfAssetSchema,
    type GltfRootJson,
} from '../../asset';
import { Transform } from '../../component-system/components/transform';
import type {
    SceneMaterialDefinition,
    SceneMeshDefinition,
    ScenePrefabDefinition,
    SceneShaderDefinition,
    SceneSnapshot,
} from '../../scene';
import {
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
    type MockGLContext,
} from './test-harness';

const trianglePositions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const triangleIndices = new Uint16Array([0, 1, 2]);

let Scene: typeof import('../../scene').Scene;
let Animator: typeof import('../../scene').Animator;
let MeshRenderer: typeof import('../../scene').MeshRenderer;

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

const withMaterialBinding = (
    prefab: ScenePrefabDefinition,
    materialId: string
): ScenePrefabDefinition => ({
    ...prefab,
    actors: prefab.actors.map((actor) => ({
        ...actor,
        components: actor.components.map((component) =>
            component.type === 'MeshRenderer'
                ? {
                      ...component,
                      data: {
                          ...(component.data as Record<string, unknown>),
                          materialId,
                      },
                  }
                : component
        ),
    })),
});

describe('glTF runtime smoke', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('../../scene');
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

        const meshAsset = receipt.assets.find((entry) => entry.kind === 'gltf.mesh');
        const prefabAsset = receipt.assets.find((entry) => entry.kind === 'gltf.prefab');

        expect(meshAsset?.kind).toBe('gltf.mesh');
        expect(prefabAsset?.kind).toBe('gltf.prefab');

        if (!meshAsset || meshAsset.kind !== 'gltf.mesh' || !prefabAsset || prefabAsset.kind !== 'gltf.prefab') {
            throw new Error('Expected rig import to produce mesh and prefab assets');
        }

        const shader: SceneShaderDefinition = {
            id: 'test/skinned-smoke',
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
        };
        const material: SceneMaterialDefinition = {
            id: 'test/skinned-smoke-material',
            shaderId: shader.id,
        };
        const prefab = withMaterialBinding(prefabAsset.data.definition, material.id);
        const snapshot: SceneSnapshot = {
            version: 1,
            prefab,
            shaders: [shader],
            meshes: [
                {
                    ...(meshAsset.data.definition as SceneMeshDefinition),
                    id: meshAsset.key,
                },
            ],
            materials: [material],
            textures: [],
            samplers: [],
            renderPasses: [],
        };

        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as unknown as MockGLContext;

        try {
            const firstInstance = await scene.loadScene(snapshot, { namePrefix: 'A ' });
            const secondInstance = scene.instantiatePrefab(prefab, { namePrefix: 'B ' });
            const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
            camera.requireComponent(Transform).position = new Vec3(0, 0, 5);

            const firstRootActor = firstInstance.find((actor) => actor.name === 'A Joint Root');
            const firstMeshActor = firstInstance.find((actor) => actor.name === 'A Mesh Root');
            const secondRootActor = secondInstance.find((actor) => actor.name === 'B Joint Root');
            const secondMeshActor = secondInstance.find((actor) => actor.name === 'B Mesh Root');
            const firstAnimator = firstRootActor?.getComponent(Animator) ?? null;

            expect(firstMeshActor?.getComponent(MeshRenderer)?.skin).toMatchObject({
                jointNodeIds: ['node/0'],
                skeletonNodeId: 'node/0',
            });

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
});