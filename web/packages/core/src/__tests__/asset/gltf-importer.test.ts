import { describe, expect, it } from 'vitest';
import { TextureFormat } from '../../renderer/webgl2/texture/interfaces';
import {
    AssetDatabase,
    createGltfImporter,
    createGltfTextureTranscodeStage,
    createPassthroughGltfTextureTranscoder,
    GltfTextureTranscoderRegistry,
    type GltfAssetSchema,
    type GltfRootJson,
} from '../../asset';

const pngHeaderBytes = new Uint8Array([137, 80, 78, 71]);

const createBinaryBlob = (): Uint8Array => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint16Array([0, 1, 2]);
    const image = pngHeaderBytes;
    const total = positions.byteLength + indices.byteLength + image.byteLength + 2;
    const bytes = new Uint8Array(total);
    bytes.set(new Uint8Array(positions.buffer), 0);
    bytes.set(new Uint8Array(indices.buffer), positions.byteLength);
    bytes.set(image, positions.byteLength + indices.byteLength);
    return bytes;
};

const createExtendedBinaryBlob = (): Uint8Array => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const tangents = new Float32Array([
        1, 0, 0, 1,
        1, 0, 0, 1,
        1, 0, 0, 1,
    ]);
    const uv1 = new Float32Array([0, 0, 1, 0, 0, 1]);
    const indices = new Uint16Array([0, 1, 2]);
    const total =
        positions.byteLength +
        tangents.byteLength +
        uv1.byteLength +
        indices.byteLength +
        pngHeaderBytes.byteLength +
        2;
    const bytes = new Uint8Array(total);
    let offset = 0;
    bytes.set(new Uint8Array(positions.buffer), offset);
    offset += positions.byteLength;
    bytes.set(new Uint8Array(tangents.buffer), offset);
    offset += tangents.byteLength;
    bytes.set(new Uint8Array(uv1.buffer), offset);
    offset += uv1.byteLength;
    bytes.set(new Uint8Array(indices.buffer), offset);
    offset += indices.byteLength;
    bytes.set(pngHeaderBytes, offset);
    return bytes;
};

const createTriangleJson = (bufferUri?: string, imageUri?: string, imageMimeType?: string): GltfRootJson => ({
    asset: {
        version: '2.0',
        generator: 'vitest',
    },
    buffers: [
        {
            ...(bufferUri ? { uri: bufferUri } : {}),
            byteLength: 48,
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
            byteLength: 6,
        },
        imageUri
            ? {
                  buffer: 0,
                  byteOffset: 0,
                  byteLength: 0,
              }
            : {
                  buffer: 0,
                  byteOffset: 42,
                  byteLength: 4,
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
            type: 'SCALAR',
        },
    ],
    images: [
        imageUri
            ? {
                  uri: imageUri,
                  mimeType: imageMimeType,
                  name: 'Albedo',
              }
            : {
                  bufferView: 2,
                  mimeType: 'image/png',
                  name: 'Albedo',
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
            name: 'Base',
        },
    ],
    materials: [
        {
            name: 'Material',
            pbrMetallicRoughness: {
                baseColorFactor: [1, 0.5, 0.25, 1],
                baseColorTexture: {
                    index: 0,
                },
                metallicFactor: 0.1,
                roughnessFactor: 0.9,
            },
        },
    ],
    meshes: [
        {
            name: 'Triangle',
            primitives: [
                {
                    attributes: {
                        POSITION: 0,
                    },
                    indices: 1,
                    material: 0,
                },
            ],
        },
    ],
    nodes: [
        {
            name: 'Root',
            mesh: 0,
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

const createExtendedAttributeJson = (): GltfRootJson => ({
    ...createTriangleJson(),
    extensionsUsed: ['KHR_materials_clearcoat'],
    buffers: [
        {
            byteLength: 116,
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
            byteLength: 48,
        },
        {
            buffer: 0,
            byteOffset: 84,
            byteLength: 24,
        },
        {
            buffer: 0,
            byteOffset: 108,
            byteLength: 6,
        },
        {
            buffer: 0,
            byteOffset: 114,
            byteLength: 4,
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
            type: 'VEC4',
        },
        {
            bufferView: 2,
            componentType: 5126,
            count: 3,
            type: 'VEC2',
        },
        {
            bufferView: 3,
            componentType: 5123,
            count: 3,
            type: 'SCALAR',
        },
    ],
    images: [
        {
            bufferView: 4,
            mimeType: 'image/png',
            name: 'Albedo',
        },
    ],
    meshes: [
        {
            name: 'Triangle',
            primitives: [
                {
                    attributes: {
                        POSITION: 0,
                        TANGENT: 1,
                        TEXCOORD_1: 2,
                        JOINTS_0: 2,
                    },
                    indices: 3,
                    material: 0,
                },
            ],
        },
    ],
});

describe('glTF importer', () => {
    it('imports GLB sources into document, prefab, mesh, material, and transcoded texture assets', async () => {
        const registry = new GltfTextureTranscoderRegistry([
            {
                id: 'test.texture.transcoder',
                canTranscode: ({ texture }) => texture.payload.kind === 'raw',
                transcode: ({ texture }) => ({
                    payload: {
                        kind: 'compressed',
                        bytes: new Uint8Array([9, 8, 7]),
                        container: 'ktx2',
                        mimeType: 'image/ktx2',
                        targetFormat: TextureFormat.BC7_RGBA,
                        uri: texture.payload.uri,
                    },
                    runtimeFormat: TextureFormat.BC7_RGBA,
                    state: {
                        status: 'transcoded',
                        transcoderId: 'test.texture.transcoder',
                        targetFormat: TextureFormat.BC7_RGBA,
                    },
                    diagnostics: [
                        {
                            level: 'info',
                            code: 'gltf.texture.transcoded',
                            message: 'texture transcoded',
                        },
                    ],
                }),
            },
        ]);

        const database = new AssetDatabase<GltfAssetSchema>({
            importers: [createGltfImporter()],
            stages: [createGltfTextureTranscodeStage({ registry })],
        });

        const receipt = await database.import({
            kind: 'bytes',
            data: createGlb(createTriangleJson(), createBinaryBlob()),
            uri: 'models/triangle.glb',
            mimeType: 'model/gltf-binary',
        });

        expect(receipt.primary.kind).toBe('gltf.document');
        expect(receipt.assets).toHaveLength(5);
        expect(receipt.diagnostics.map((entry) => entry.code)).toContain(
            'gltf.texture.transcoded'
        );

        const texture = receipt.assets.find((entry) => entry.kind === 'gltf.texture');
        const material = receipt.assets.find((entry) => entry.kind === 'gltf.material');
        const mesh = receipt.assets.find((entry) => entry.kind === 'gltf.mesh');
        const prefab = receipt.assets.find((entry) => entry.kind === 'gltf.prefab');

        expect(texture?.data.payload.kind).toBe('compressed');
        expect(texture?.data.runtimeFormat).toBe(TextureFormat.BC7_RGBA);
        expect(material?.data.definition.textures?._BaseColorTexture).toBe(texture?.key);
        expect(mesh?.data.definition.topology).toBe('triangles');
        expect(prefab?.data.definition.actors[0]?.components).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: 'Transform' }),
                expect.objectContaining({
                    type: 'MeshRenderer',
                    data: expect.objectContaining({
                        meshId: mesh?.key,
                        materialId: material?.key,
                    }),
                }),
            ])
        );
        expect(receipt.primary.data.scenes[0]?.prefabKey).toBe(prefab?.key);
    });

    it('imports text glTF sources with external resource resolution', async () => {
        const binary = createBinaryBlob();
        const database = new AssetDatabase<GltfAssetSchema>({
            importers: [
                createGltfImporter({
                    resourceResolver: ({ uri }) => {
                        if (uri === 'mesh.bin') {
                            return {
                                uri,
                                bytes: binary,
                                mimeType: 'application/octet-stream',
                            };
                        }

                        if (uri === 'albedo.ktx2') {
                            return {
                                uri,
                                bytes: new Uint8Array([1, 2, 3, 4]),
                                mimeType: 'image/ktx2',
                            };
                        }

                        return undefined;
                    },
                }),
            ],
            stages: [
                createGltfTextureTranscodeStage({
                    registry: new GltfTextureTranscoderRegistry([
                        createPassthroughGltfTextureTranscoder(TextureFormat.ASTC_4x4),
                    ]),
                }),
            ],
        });

        const json = createTriangleJson('mesh.bin', 'albedo.ktx2', 'image/ktx2');
        json.bufferViews = [
            {
                buffer: 0,
                byteOffset: 0,
                byteLength: 36,
            },
            {
                buffer: 0,
                byteOffset: 36,
                byteLength: 6,
            },
        ];

        const receipt = await database.import({
            kind: 'text',
            data: JSON.stringify(json),
            uri: 'assets/model.gltf',
            mimeType: 'model/gltf+json',
        });

        const texture = receipt.assets.find((entry) => entry.kind === 'gltf.texture');
        expect(receipt.primary.data.format).toBe('gltf');
        expect(texture?.data.payload.kind).toBe('compressed');
        expect(texture?.data.runtimeFormat).toBe(TextureFormat.ASTC_4x4);
        expect(texture?.data.payload.uri).toBe('albedo.ktx2');
        expect(receipt.primary.data.stats.textureCount).toBe(1);
        expect(receipt.primary.data.scenes).toHaveLength(1);
    });

    it('preserves tangent and secondary uv attributes while warning on ignored semantics', async () => {
        const database = new AssetDatabase<GltfAssetSchema>({
            importers: [createGltfImporter()],
        });

        const receipt = await database.import({
            kind: 'bytes',
            data: createGlb(createExtendedAttributeJson(), createExtendedBinaryBlob()),
            uri: 'models/triangle-extended.glb',
            mimeType: 'model/gltf-binary',
        });

        const mesh = receipt.assets.find((entry) => entry.kind === 'gltf.mesh');
        expect(mesh?.data.definition.attributes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ semantic: 'position', componentCount: 3 }),
                expect.objectContaining({ semantic: 'tangent', componentCount: 4 }),
                expect.objectContaining({ semantic: 'uv1', componentCount: 2 }),
            ])
        );
        expect(receipt.diagnostics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'gltf.extension.unsupported',
                    level: 'warning',
                }),
                expect.objectContaining({
                    code: 'gltf.mesh.attribute.unsupported',
                    level: 'warning',
                }),
            ])
        );
    });

    it('fails fast for unsupported required glTF extensions', async () => {
        const database = new AssetDatabase<GltfAssetSchema>({
            importers: [createGltfImporter()],
        });

        await expect(
            database.import({
                kind: 'text',
                data: JSON.stringify({
                    ...createTriangleJson(),
                    extensionsRequired: ['KHR_materials_clearcoat'],
                } satisfies GltfRootJson),
                uri: 'models/unsupported-required.gltf',
                mimeType: 'model/gltf+json',
            })
        ).rejects.toThrow('Unsupported required glTF extensions: KHR_materials_clearcoat');
    });

    it('imports glTF cameras into prefab snapshots and marks the default scene camera as primary', async () => {
        const database = new AssetDatabase<GltfAssetSchema>({
            importers: [createGltfImporter()],
        });

        const receipt = await database.import({
            kind: 'bytes',
            data: createGlb({
                ...createTriangleJson(),
                cameras: [
                    {
                        type: 'perspective',
                        perspective: {
                            yfov: Math.PI / 3,
                            znear: 0.5,
                            zfar: 250,
                        },
                        name: 'Main Camera',
                    },
                ],
                nodes: [
                    {
                        name: 'Camera Root',
                        camera: 0,
                        translation: [0, 2, 5],
                    },
                    {
                        name: 'Mesh Root',
                        mesh: 0,
                    },
                ],
                scenes: [
                    {
                        name: 'Main',
                        nodes: [0, 1],
                    },
                ],
            } satisfies GltfRootJson, createBinaryBlob()),
            uri: 'models/camera-scene.glb',
            mimeType: 'model/gltf-binary',
        });

        const prefab = receipt.assets.find((entry) => entry.kind === 'gltf.prefab');
        const cameraActor = prefab?.data.definition.actors.find(
            (actor) => actor.name === 'Camera Root'
        );
        const cameraComponent = cameraActor?.components.find(
            (component) => component.type === 'Camera'
        );

        expect(cameraActor?.components).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: 'Transform' }),
                expect.objectContaining({ type: 'Camera' }),
            ])
        );
        expect(cameraComponent?.data).toMatchObject({
            primary: true,
            near: 0.5,
            far: 250,
            orthographic: false,
        });
        expect((cameraComponent?.data as { fieldOfView?: number } | undefined)?.fieldOfView).toBeCloseTo(60, 10);
        expect(receipt.primary.data.stats.cameraCount).toBe(1);
    });

    it('warns when glTF animations and skins are present without runtime support', async () => {
        const database = new AssetDatabase<GltfAssetSchema>({
            importers: [createGltfImporter()],
        });

        const receipt = await database.import({
            kind: 'bytes',
            data: createGlb({
                ...createTriangleJson(),
                skins: [
                    {
                        joints: [0],
                    },
                ],
                nodes: [
                    {
                        name: 'Root',
                        mesh: 0,
                        skin: 0,
                    },
                ],
                animations: [
                    {
                        samplers: [
                            {
                                input: 0,
                                output: 1,
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
                        ],
                    },
                ],
            } satisfies GltfRootJson, createBinaryBlob()),
            uri: 'models/unsupported-features.glb',
            mimeType: 'model/gltf-binary',
        });

        expect(receipt.diagnostics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'gltf.skin.unsupported',
                    level: 'warning',
                }),
                expect.objectContaining({
                    code: 'gltf.animation.unsupported',
                    level: 'warning',
                }),
            ])
        );
        expect(receipt.primary.data.stats.skinCount).toBe(1);
        expect(receipt.primary.data.stats.animationCount).toBe(1);
    });

    it('prefers KHR_texture_basisu sources over fallback texture images', async () => {
        const binary = createBinaryBlob();
        const database = new AssetDatabase<GltfAssetSchema>({
            importers: [
                createGltfImporter({
                    resourceResolver: ({ uri }) => {
                        if (uri === 'mesh.bin') {
                            return {
                                uri,
                                bytes: binary,
                                mimeType: 'application/octet-stream',
                            };
                        }

                        if (uri === 'albedo.png') {
                            return {
                                uri,
                                bytes: pngHeaderBytes,
                                mimeType: 'image/png',
                            };
                        }

                        if (uri === 'albedo.ktx2') {
                            return {
                                uri,
                                bytes: new Uint8Array([11, 22, 33, 44]),
                                mimeType: 'image/ktx2',
                            };
                        }

                        return undefined;
                    },
                }),
            ],
        });

        const json = createTriangleJson('mesh.bin', 'albedo.png', 'image/png');
        json.images = [
            {
                uri: 'albedo.png',
                mimeType: 'image/png',
                name: 'Fallback',
            },
            {
                uri: 'albedo.ktx2',
                mimeType: 'image/ktx2',
                name: 'BasisU',
            },
        ];
        json.textures = [
            {
                source: 0,
                sampler: 0,
                name: 'Base',
                extensions: {
                    KHR_texture_basisu: {
                        source: 1,
                    },
                },
            },
        ];
        json.extensionsUsed = ['KHR_texture_basisu'];
        json.bufferViews = [
            {
                buffer: 0,
                byteOffset: 0,
                byteLength: 36,
            },
            {
                buffer: 0,
                byteOffset: 36,
                byteLength: 6,
            },
        ];

        const receipt = await database.import({
            kind: 'text',
            data: JSON.stringify(json),
            uri: 'assets/basisu-texture.gltf',
            mimeType: 'model/gltf+json',
        });

        const texture = receipt.assets.find((entry) => entry.kind === 'gltf.texture');

        expect(texture?.data.imageIndex).toBe(1);
        expect(texture?.data.payload.kind).toBe('compressed');
        expect(texture?.data.payload.uri).toBe('albedo.ktx2');
        expect(receipt.diagnostics.map((entry) => entry.code)).not.toContain(
            'gltf.extension.unsupported'
        );
    });
});
