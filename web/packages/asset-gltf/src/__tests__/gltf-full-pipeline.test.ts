import { describe, expect, it } from 'vitest';
import {
    AssetDatabase,
} from '@axrone/asset-core';
import {
    createGltfImporter,
    createGltfAssetDisposers,
    type GltfAssetSchema,
    type GltfRootJson,
} from '@axrone/asset-gltf';

// ---------------------------------------------------------------------------
// Helpers: build a comprehensive GLB in-memory that exercises all 6 phases
// ---------------------------------------------------------------------------

const pngHeaderBytes = new Uint8Array([137, 80, 78, 71]);

/**
 * Vertex data — a quad (4 vertices, 6 indices, 2 triangles).
 */
const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0,
]);
const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
]);
const uvs = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
]);
const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

/**
 * Skin data — 3 joints with identity-ish inverse bind matrices (column-major).
 */
const inverseBindMatrices = new Float32Array([
    // Joint 0: identity
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
    // Joint 1: translation(1, 0, 0)
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    1, 0, 0, 1,
    // Joint 2: translation(0, 2, 0)
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 2, 0, 1,
]);

/**
 * Animation data — 2 channels: translation + rotation.
 */
const animTimesTranslation = new Float32Array([0, 1.5]);
const animValuesTranslation = new Float32Array([
    0, 0, 0,
    2, 0, 0,
]);
const animTimesRotation = new Float32Array([0, 1.5]);
const animValuesRotation = new Float32Array([
    0, 0, 0, 1,
    0, 0, 0.7071, 0.7071,
]);

/**
 * Pack all data into a single binary buffer with correct alignment.
 *
 * BufferView layout:
 *  0: positions   offset=0   length=48
 *  1: normals     offset=48  length=48
 *  2: uvs         offset=96  length=32
 *  3: indices     offset=128 length=12
 *  4: png image   offset=140 length=4
 *  5: IBM         offset=144 length=192
 *  6: anim times  offset=336 length=8
 *  7: anim vals T offset=344 length=24
 *  8: anim times  offset=368 length=8
 *  9: anim vals R offset=376 length=32
 *
 * Total: 408 bytes
 */
const createFullPipelineBlob = (): Uint8Array => {
    const total = 408;
    const bytes = new Uint8Array(total);
    let offset = 0;

    bytes.set(new Uint8Array(positions.buffer), offset); offset += positions.byteLength;       // 0..48
    bytes.set(new Uint8Array(normals.buffer), offset);  offset += normals.byteLength;          // 48..96
    bytes.set(new Uint8Array(uvs.buffer), offset);      offset += uvs.byteLength;              // 96..128
    bytes.set(new Uint8Array(indices.buffer), offset);  offset += indices.byteLength;          // 128..140
    bytes.set(pngHeaderBytes, offset);                  offset += pngHeaderBytes.byteLength;   // 140..144
    bytes.set(new Uint8Array(inverseBindMatrices.buffer), offset); offset += inverseBindMatrices.byteLength; // 144..336
    bytes.set(new Uint8Array(animTimesTranslation.buffer), offset); offset += animTimesTranslation.byteLength; // 336..344
    bytes.set(new Uint8Array(animValuesTranslation.buffer), offset); offset += animValuesTranslation.byteLength; // 344..368
    bytes.set(new Uint8Array(animTimesRotation.buffer), offset); offset += animTimesRotation.byteLength; // 368..376
    bytes.set(new Uint8Array(animValuesRotation.buffer), offset); // 376..408

    return bytes;
};

/**
 * Build the GLTF JSON that references all the buffer views above.
 *
 * Scene graph:
 *   node/0 "SceneRoot"      children:[1,2]
 *   node/1 "Armature"       children:[3]          (skeleton root)
 *   node/2 "SkinnedMesh"    mesh:0, skin:0
 *   node/3 "Joint0"         children:[4]
 *   node/4 "Joint1"         children:[5]
 *   node/5 "Joint2"
 *
 * Animation:
 *   channel 0 → translation on node/0
 *   channel 1 → rotation on node/2
 */
const createFullPipelineJson = (): GltfRootJson => ({
    asset: {
        version: '2.0',
        generator: 'vitest-full-pipeline',
    },
    buffers: [
        {
            byteLength: 408,
        },
    ],
    bufferViews: [
        { buffer: 0, byteOffset: 0,   byteLength: 48  },  // 0: positions
        { buffer: 0, byteOffset: 48,  byteLength: 48  },  // 1: normals
        { buffer: 0, byteOffset: 96,  byteLength: 32  },  // 2: uvs
        { buffer: 0, byteOffset: 128, byteLength: 12  },  // 3: indices
        { buffer: 0, byteOffset: 140, byteLength: 4   },  // 4: png image
        { buffer: 0, byteOffset: 144, byteLength: 192 },  // 5: IBM
        { buffer: 0, byteOffset: 336, byteLength: 8   },  // 6: anim times (trans)
        { buffer: 0, byteOffset: 344, byteLength: 24  },  // 7: anim values (trans)
        { buffer: 0, byteOffset: 368, byteLength: 8   },  // 8: anim times (rot)
        { buffer: 0, byteOffset: 376, byteLength: 32  },  // 9: anim values (rot)
    ],
    accessors: [
        // 0: positions
        {
            bufferView: 0,
            componentType: 5126,
            count: 4,
            type: 'VEC3',
            min: [0, 0, 0],
            max: [1, 1, 0],
        },
        // 1: normals
        {
            bufferView: 1,
            componentType: 5126,
            count: 4,
            type: 'VEC3',
        },
        // 2: uvs
        {
            bufferView: 2,
            componentType: 5126,
            count: 4,
            type: 'VEC2',
        },
        // 3: indices
        {
            bufferView: 3,
            componentType: 5123,
            count: 6,
            type: 'SCALAR',
        },
        // 4: inverse bind matrices
        {
            bufferView: 5,
            componentType: 5126,
            count: 3,
            type: 'MAT4',
        },
        // 5: animation times (translation)
        {
            bufferView: 6,
            componentType: 5126,
            count: 2,
            type: 'SCALAR',
            min: [0],
            max: [1.5],
        },
        // 6: animation values (translation)
        {
            bufferView: 7,
            componentType: 5126,
            count: 2,
            type: 'VEC3',
        },
        // 7: animation times (rotation)
        {
            bufferView: 8,
            componentType: 5126,
            count: 2,
            type: 'SCALAR',
            min: [0],
            max: [1.5],
        },
        // 8: animation values (rotation)
        {
            bufferView: 9,
            componentType: 5126,
            count: 2,
            type: 'VEC4',
        },
    ],
    images: [
        {
            bufferView: 4,
            mimeType: 'image/png',
            name: 'BaseColor',
        },
    ],
    samplers: [
        {
            minFilter: 9987,
            magFilter: 9729,
            wrapS: 10497,
            wrapT: 10497,
        },
    ],
    textures: [
        {
            source: 0,
            sampler: 0,
            name: 'BaseColorTexture',
        },
    ],
    materials: [
        {
            name: 'PBRMaterial',
            pbrMetallicRoughness: {
                baseColorFactor: [0.8, 0.2, 0.1, 1.0],
                baseColorTexture: {
                    index: 0,
                },
                metallicFactor: 0.5,
                roughnessFactor: 0.4,
            },
            alphaMode: 'OPAQUE',
            doubleSided: false,
        },
    ],
    meshes: [
        {
            name: 'Quad',
            primitives: [
                {
                    attributes: {
                        POSITION: 0,
                        NORMAL: 1,
                        TEXCOORD_0: 2,
                    },
                    indices: 3,
                    material: 0,
                    mode: 4,
                },
            ],
        },
    ],
    skins: [
        {
            name: 'Armature',
            inverseBindMatrices: 4,
            skeleton: 1,
            joints: [3, 4, 5],
        },
    ],
    animations: [
        {
            name: 'MoveAndSpin',
            samplers: [
                {
                    input: 5,
                    output: 6,
                    interpolation: 'LINEAR',
                },
                {
                    input: 7,
                    output: 8,
                    interpolation: 'LINEAR',
                },
            ],
            channels: [
                {
                    sampler: 0,
                    target: {
                        node: 0,
                        path: 'translation',
                    },
                },
                {
                    sampler: 1,
                    target: {
                        node: 2,
                        path: 'rotation',
                    },
                },
            ],
        },
    ],
    nodes: [
        {
            name: 'SceneRoot',
            children: [1, 2],
            translation: [0, 0, 0],
        },
        {
            name: 'Armature',
            children: [3],
        },
        {
            name: 'SkinnedMesh',
            mesh: 0,
            skin: 0,
        },
        {
            name: 'Joint0',
            children: [4],
            translation: [0, 0, 0],
        },
        {
            name: 'Joint1',
            children: [5],
            translation: [1, 0, 0],
        },
        {
            name: 'Joint2',
            translation: [0, 1, 0],
        },
    ],
    scenes: [
        {
            name: 'MainScene',
            nodes: [0],
        },
    ],
    scene: 0,
});

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

// ---------------------------------------------------------------------------
// Shared import — run once, then all describe groups assert against it
// ---------------------------------------------------------------------------

const importFullPipeline = async () => {
    const database = new AssetDatabase<GltfAssetSchema>({
        importers: [createGltfImporter()],
    });

    const receipt = await database.import({
        kind: 'bytes',
        data: createGlb(createFullPipelineJson(), createFullPipelineBlob()),
        uri: 'models/full-pipeline.glb',
        mimeType: 'model/gltf-binary',
    });

    const document = receipt.primary;
    const prefab = receipt.assets.find((e) => e.kind === 'gltf.prefab');
    const mesh = receipt.assets.find((e) => e.kind === 'gltf.mesh');
    const material = receipt.assets.find((e) => e.kind === 'gltf.material');
    const texture = receipt.assets.find((e) => e.kind === 'gltf.texture');
    const skin = receipt.assets.find((e) => e.kind === 'gltf.skin');
    const animation = receipt.assets.find((e) => e.kind === 'gltf.animation');

    return { database, receipt, document, prefab, mesh, material, texture, skin, animation };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gltf full pipeline', () => {
    // -----------------------------------------------------------------------
    // Full Pipeline
    // -----------------------------------------------------------------------
    describe('full pipeline', () => {
        it('produces a primary document asset of kind gltf.document', async () => {
            const { receipt } = await importFullPipeline();
            expect(receipt.primary.kind).toBe('gltf.document');
        });

        it('produces assets for every pipeline phase (document, prefab, mesh, material, texture, skin, animation)', async () => {
            const { receipt } = await importFullPipeline();
            const kinds = receipt.assets.map((a) => a.kind).sort();
            expect(kinds).toEqual([
                'gltf.animation',
                'gltf.document',
                'gltf.material',
                'gltf.mesh',
                'gltf.prefab',
                'gltf.skin',
                'gltf.texture',
            ]);
        });

        it('returns a non-empty diagnostics array (may be empty for clean imports)', async () => {
            const { receipt } = await importFullPipeline();
            expect(Array.isArray(receipt.diagnostics)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Document Asset
    // -----------------------------------------------------------------------
    describe('document asset', () => {
        it('has correct id, format, and version', async () => {
            const { document } = await importFullPipeline();
            expect(document.data.format).toBe('glb');
            expect(document.data.version).toBe('2.0');
            expect(document.data.id).toBeDefined();
        });

        it('lists one scene with a valid prefabKey', async () => {
            const { document, prefab } = await importFullPipeline();
            expect(document.data.scenes).toHaveLength(1);
            expect(document.data.scenes[0]!.name).toBe('MainScene');
            expect(document.data.scenes[0]!.prefabKey).toBe(prefab!.key);
        });

        it('tracks meshKeys, skinKeys, animationKeys, materialKeys, and textureKeys', async () => {
            const { document, mesh, skin, animation, material, texture } = await importFullPipeline();
            expect(document.data.meshKeys).toEqual([mesh!.key]);
            expect(document.data.skinKeys).toEqual([skin!.key]);
            expect(document.data.animationKeys).toEqual([animation!.key]);
            expect(document.data.materialKeys).toEqual([material!.key]);
            expect(document.data.textureKeys).toEqual([texture!.key]);
        });

        it('reports accurate stats for the scene', async () => {
            const { document } = await importFullPipeline();
            const { stats } = document.data;
            expect(stats.sceneCount).toBe(1);
            expect(stats.meshCount).toBe(1);
            expect(stats.materialCount).toBe(1);
            expect(stats.textureCount).toBe(1);
            expect(stats.skinCount).toBe(1);
            expect(stats.animationCount).toBe(1);
            expect(stats.nodeCount).toBe(6);
            expect(stats.primitiveCount).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Mesh Assets
    // -----------------------------------------------------------------------
    describe('mesh assets', () => {
        it('has the correct topology and vertex count', async () => {
            const { mesh } = await importFullPipeline();
            expect(mesh!.data.definition.topology).toBe('triangles');
            expect(mesh!.data.definition.vertexCount).toBe(4);
        });

        it('contains position, normal, and uv vertex attributes', async () => {
            const { mesh } = await importFullPipeline();
            const { attributes } = mesh!.data.definition;
            expect(attributes).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ semantic: 'position', componentCount: 3 }),
                    expect.objectContaining({ semantic: 'normal', componentCount: 3 }),
                    expect.objectContaining({ semantic: 'uv0', componentCount: 2 }),
                ])
            );
        });

        it('has the correct index buffer', async () => {
            const { mesh } = await importFullPipeline();
            expect(mesh!.data.definition.indices).toEqual(
                new Uint16Array([0, 1, 2, 0, 2, 3])
            );
        });

        it('has correct bounding box from accessor min/max', async () => {
            const { mesh } = await importFullPipeline();
            expect(mesh!.data.bounds).toEqual({
                min: [0, 0, 0],
                max: [1, 1, 0],
            });
        });

        it('references the correct material key', async () => {
            const { mesh, material } = await importFullPipeline();
            expect(mesh!.data.materialKey).toBe(material!.key);
        });
    });

    // -----------------------------------------------------------------------
    // Material Assets
    // -----------------------------------------------------------------------
    describe('material assets', () => {
        it('has correct PBR base color factor and metallic/roughness uniforms', async () => {
            const { material } = await importFullPipeline();
            const { uniforms } = material!.data.definition;
            expect(uniforms._BaseColorFactor).toEqual([0.8, 0.2, 0.1, 1.0]);
            expect(uniforms._MetallicFactor).toBe(0.5);
            expect(uniforms._RoughnessFactor).toBe(0.4);
        });

        it('binds the base color texture', async () => {
            const { material, texture } = await importFullPipeline();
            expect(material!.data.definition.textures?._BaseColorTexture).toBe(texture!.key);
        });

        it('reports OPAQUE alpha mode and single-sided', async () => {
            const { material } = await importFullPipeline();
            expect(material!.data.alphaMode).toBe('OPAQUE');
            expect(material!.data.doubleSided).toBe(false);
        });

        it('stores alpha mode and double-sided as uniforms', async () => {
            const { material } = await importFullPipeline();
            expect(material!.data.definition.uniforms._AlphaMode).toBe(0);
            expect(material!.data.definition.uniforms._DoubleSided).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Skin Assets
    // -----------------------------------------------------------------------
    describe('skin assets', () => {
        it('has 3 joint node ids matching the GLTF joint indices', async () => {
            const { skin } = await importFullPipeline();
            expect(skin!.data.jointNodeIds).toEqual(['node/3', 'node/4', 'node/5']);
        });

        it('references the skeleton node', async () => {
            const { skin } = await importFullPipeline();
            expect(skin!.data.skeletonNodeId).toBe('node/1');
        });

        it('contains inverse bind matrices in row-major layout (transposed from GLTF column-major)', async () => {
            const { skin } = await importFullPipeline();
            const ibm = skin!.data.inverseBindMatrices!;
            expect(ibm).toBeInstanceOf(Float32Array);
            expect(ibm.length).toBe(48); // 3 joints × 16 floats

            // Joint 0: identity → row-major same as column-major
            expect(ibm.slice(0, 16)).toEqual(new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1,
            ]));

            // Joint 1: translation(1,0,0) → row-major: tx in row 0 col 3
            expect(ibm.slice(16, 32)).toEqual(new Float32Array([
                1, 0, 0, 1,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1,
            ]));

            // Joint 2: translation(0,2,0) → row-major: ty in row 1 col 3
            expect(ibm.slice(32, 48)).toEqual(new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 2,
                0, 0, 1, 0,
                0, 0, 0, 1,
            ]));
        });
    });

    // -----------------------------------------------------------------------
    // Animation Assets
    // -----------------------------------------------------------------------
    describe('animation assets', () => {
        it('has the correct clip id and duration', async () => {
            const { animation } = await importFullPipeline();
            expect(animation!.data.id).toBe('MoveAndSpin');
            expect(animation!.data.duration).toBe(1.5);
        });

        it('has exactly 2 tracks', async () => {
            const { animation } = await importFullPipeline();
            expect(animation!.data.tracks).toHaveLength(2);
        });

        it('has a translation track targeting node/0 with correct times and values', async () => {
            const { animation } = await importFullPipeline();
            const translationTrack = animation!.data.tracks.find(
                (t) => t.path === 'translation'
            );
            expect(translationTrack).toBeDefined();
            expect(translationTrack!.targetNodeId).toBe('node/0');
            expect(translationTrack!.interpolation).toBe('LINEAR');
            expect(translationTrack!.keyframeCount).toBe(2);
            expect(translationTrack!.valueComponentCount).toBe(3);
            expect(translationTrack!.times).toEqual(new Float32Array([0, 1.5]));
            expect(translationTrack!.values).toEqual(new Float32Array([0, 0, 0, 2, 0, 0]));
        });

        it('has a rotation track targeting node/2 with correct times and values', async () => {
            const { animation } = await importFullPipeline();
            const rotationTrack = animation!.data.tracks.find(
                (t) => t.path === 'rotation'
            );
            expect(rotationTrack).toBeDefined();
            expect(rotationTrack!.targetNodeId).toBe('node/2');
            expect(rotationTrack!.interpolation).toBe('LINEAR');
            expect(rotationTrack!.keyframeCount).toBe(2);
            expect(rotationTrack!.valueComponentCount).toBe(4);
            expect(rotationTrack!.times).toEqual(new Float32Array([0, 1.5]));
            expect(rotationTrack!.values).toEqual(
                new Float32Array([0, 0, 0, 1, 0, 0, 0.7071, 0.7071])
            );
        });
    });

    // -----------------------------------------------------------------------
    // Prefab Definition
    // -----------------------------------------------------------------------
    describe('prefab definition', () => {
        it('has entities for all 6 nodes in the hierarchy', async () => {
            const { prefab } = await importFullPipeline();
            expect(prefab!.data.definition.entities).toHaveLength(6);
        });

        it('preserves the scene hierarchy with correct parent-child relationships', async () => {
            const { prefab } = await importFullPipeline();
            const entities = prefab!.data.definition.entities;
            const sceneRoot = entities.find((a) => a.name === 'SceneRoot');
            const armature = entities.find((a) => a.name === 'Armature');
            const skinnedMesh = entities.find((a) => a.name === 'SkinnedMesh');

            expect(sceneRoot).toBeDefined();
            expect(armature).toBeDefined();
            expect(skinnedMesh).toBeDefined();

            // Armature and SkinnedMesh are children of SceneRoot
            expect(armature!.parentNodeId).toBe(sceneRoot!.nodeId);
            expect(skinnedMesh!.parentNodeId).toBe(sceneRoot!.nodeId);
        });

        it('creates Transform components on every entity', async () => {
            const { prefab } = await importFullPipeline();
            for (const entity of prefab!.data.definition.entities) {
                const transform = entity.components.find((c) => c.type === 'Transform');
                expect(transform).toBeDefined();
            }
        });

        it('creates a MeshRenderer component on the SkinnedMesh entity with correct mesh and material references', async () => {
            const { prefab, mesh, material, skin } = await importFullPipeline();
            const entities = prefab!.data.definition.entities;
            const skinnedMeshEntity = entities.find((a) => a.name === 'SkinnedMesh');
            const meshRenderer = skinnedMeshEntity!.components.find((c) => c.type === 'MeshRenderer');

            expect(meshRenderer).toBeDefined();
            expect(meshRenderer!.data).toMatchObject({
                meshId: mesh!.key,
                materialId: material!.key,
            });
            // Skin data should be embedded
            expect((meshRenderer!.data as any).skin).toMatchObject({
                jointNodeIds: ['node/3', 'node/4', 'node/5'],
                skeletonNodeId: 'node/1',
            });
        });

        it('creates an Animator component with the animation clip', async () => {
            const { prefab, animation } = await importFullPipeline();
            const entities = prefab!.data.definition.entities;
            // The Animator is typically placed on the first entity or the root
            const allComponents = entities.flatMap((a) => a.components);
            const animator = allComponents.find((c) => c.type === 'Animator');

            expect(animator).toBeDefined();
            expect(animator!.data).toMatchObject({
                clipId: 'MoveAndSpin',
                playing: true,
            });
        });

        it('tracks meshKeys, skinKeys, animationKeys, and materialKeys on the prefab', async () => {
            const { prefab, mesh, skin, animation, material } = await importFullPipeline();
            expect(prefab!.data.meshKeys).toEqual([mesh!.key]);
            expect(prefab!.data.skinKeys).toEqual([skin!.key]);
            expect(prefab!.data.animationKeys).toEqual([animation!.key]);
            expect(prefab!.data.materialKeys).toEqual([material!.key]);
        });
    });

    // -----------------------------------------------------------------------
    // Diagnostics
    // -----------------------------------------------------------------------
    describe('diagnostics', () => {
        it('emits a warning when an unsupported vertex attribute semantic is present', async () => {
            const database = new AssetDatabase<GltfAssetSchema>({
                importers: [createGltfImporter()],
            });

            // Modify the JSON to add TEXCOORD_1 (unsupported secondary UV)
            const json = createFullPipelineJson();
            json.meshes = [
                {
                    name: 'Quad',
                    primitives: [
                        {
                            attributes: {
                                POSITION: 0,
                                NORMAL: 1,
                                TEXCOORD_0: 2,
                                TEXCOORD_2: 2, // unsupported semantic → triggers warning
                            },
                            indices: 3,
                            material: 0,
                            mode: 4,
                        },
                    ],
                },
            ];

            const receipt = await database.import({
                kind: 'bytes',
                data: createGlb(json, createFullPipelineBlob()),
                uri: 'models/full-pipeline-extra-uv.glb',
                mimeType: 'model/gltf-binary',
            });

            expect(receipt.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'gltf.mesh.attribute.unsupported',
                        level: 'warning',
                    }),
                ])
            );
        });

        it('does not emit skin or animation runtime-missing warnings for a complete rig', async () => {
            const { receipt } = await importFullPipeline();
            const codes = receipt.diagnostics.map((d) => d.code);
            expect(codes).not.toContain('gltf.skin.runtime-missing');
            expect(codes).not.toContain('gltf.animation.runtime-missing');
        });

        it('throws for unsupported required extensions', async () => {
            const database = new AssetDatabase<GltfAssetSchema>({
                importers: [createGltfImporter()],
            });
            const json = createFullPipelineJson();
            json.extensionsRequired = ['KHR_materials_specular'];

            await expect(
                database.import({
                    kind: 'bytes',
                    data: createGlb(json, createFullPipelineBlob()),
                    uri: 'models/unsupported.glb',
                    mimeType: 'model/gltf-binary',
                })
            ).rejects.toThrow('Unsupported required glTF extensions: KHR_materials_specular');
        });
    });

    // -----------------------------------------------------------------------
    // Disposal
    // -----------------------------------------------------------------------
    describe('disposal', () => {
        it('createGltfAssetDisposers returns disposer functions for all asset kinds', () => {
            const disposers = createGltfAssetDisposers();
            expect(typeof disposers['gltf.document']).toBe('function');
            expect(typeof disposers['gltf.prefab']).toBe('function');
            expect(typeof disposers['gltf.mesh']).toBe('function');
            expect(typeof disposers['gltf.material']).toBe('function');
            expect(typeof disposers['gltf.texture']).toBe('function');
            expect(typeof disposers['gltf.skin']).toBe('function');
            expect(typeof disposers['gltf.animation']).toBe('function');
        });

        it('texture disposer calls close() on payloads that support it', async () => {
            const disposers = createGltfAssetDisposers();
            let closed = false;
            const fakeTexture = {
                id: 'tex-0',
                textureIndex: 0,
                imageIndex: 0,
                sampler: { wrapS: 'repeat', wrapT: 'repeat', magFilter: 'linear', minFilter: 'linear' },
                payload: {
                    kind: 'raw',
                    bytes: new Uint8Array([1, 2, 3]),
                    close: () => { closed = true; },
                },
                usageHints: [],
                transcode: { transcoderId: undefined, reason: undefined, targetFormat: undefined },
            };
            const fakeRecord = Object.freeze({
                id: 'test', kind: 'gltf.texture' as const, key: 'test-key',
                data: fakeTexture, revision: 1, createdAtEpochMs: 0, updatedAtEpochMs: 0,
                metadata: {}, aliases: [], dependencies: [],
                reference: { id: 'test', kind: 'gltf.texture' as const },
            });

            disposers['gltf.texture']!(fakeTexture as any, fakeRecord as any);
            expect(closed).toBe(true);
        });

        it('document and prefab disposers run without error on real imported assets', async () => {
            const disposers = createGltfAssetDisposers();
            const { receipt } = await importFullPipeline();

            const doc = receipt.primary;
            const prefab = receipt.assets.find((e) => e.kind === 'gltf.prefab')!;

            expect(() => {
                disposers['gltf.document']!(doc.data as any, doc as any);
            }).not.toThrow();

            expect(() => {
                disposers['gltf.prefab']!(prefab.data as any, prefab as any);
            }).not.toThrow();
        });
    });
});
