import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BasisLoader } from '@loaders.gl/textures';
import {
    AssetDatabase,
    createLoadersBasisGltfTextureTranscoder,
    createGltfImporter,
    createGltfTextureTranscodeStage,
    GltfTextureTranscoderRegistry,
    type GltfCompressedTexturePayload,
    type GltfAssetSchema,
    type GltfTextureAsset,
    type GltfRootJson,
} from '../../asset';
import {
    FilterMode,
    TextureFormat,
    WrapMode,
} from '../../renderer/webgl2/texture/interfaces';

vi.mock('@loaders.gl/textures', () => ({
    BASIS_EXTERNAL_LIBRARIES: {
        TRANSCODER: 'basis_transcoder.js',
        TRANSCODER_WASM: 'basis_transcoder.wasm',
        ENCODER: 'basis_encoder.js',
        ENCODER_WASM: 'basis_encoder.wasm',
    },
    BasisLoader: {
        parse: vi.fn(),
    },
}));

const parseBasisMock = vi.mocked(BasisLoader.parse);

const trianglePositions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const triangleIndices = new Uint16Array([0, 1, 2]);

const createBinaryBlob = (): Uint8Array => {
    const total = trianglePositions.byteLength + triangleIndices.byteLength;
    const bytes = new Uint8Array(total);
    bytes.set(new Uint8Array(trianglePositions.buffer), 0);
    bytes.set(new Uint8Array(triangleIndices.buffer), trianglePositions.byteLength);
    return bytes;
};

const writeUint64 = (view: DataView, byteOffset: number, value: number): void => {
    view.setUint32(byteOffset, value >>> 0, true);
    view.setUint32(byteOffset + 4, Math.floor(value / 0x1_0000_0000), true);
};

const createKtx2Texture = (
    levels: readonly Uint8Array[],
    options: {
        readonly vkFormat?: number;
        readonly width?: number;
        readonly height?: number;
        readonly supercompressionScheme?: number;
    } = {}
): Uint8Array => {
    const vkFormat = options.vkFormat ?? 0;
    const width = options.width ?? 4;
    const height = options.height ?? 4;
    const headerLength = 80;
    const levelIndexLength = levels.length * 24;
    const dataOffset = headerLength + levelIndexLength;
    const totalLength = dataOffset + levels.reduce((total, level) => total + level.byteLength, 0);
    const bytes = new Uint8Array(totalLength);
    const view = new DataView(bytes.buffer);

    bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    view.setUint32(12, vkFormat, true);
    view.setUint32(16, 1, true);
    view.setUint32(20, width, true);
    view.setUint32(24, height, true);
    view.setUint32(36, 1, true);
    view.setUint32(40, levels.length, true);
    view.setUint32(44, options.supercompressionScheme ?? 0, true);

    let levelDataOffset = dataOffset;
    for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
        const level = levels[levelIndex]!;
        const entryOffset = headerLength + levelIndex * 24;
        writeUint64(view, entryOffset, levelDataOffset);
        writeUint64(view, entryOffset + 8, level.byteLength);
        writeUint64(view, entryOffset + 16, level.byteLength);
        bytes.set(level, levelDataOffset);
        levelDataOffset += level.byteLength;
    }

    return bytes;
};

const createTriangleJson = (bufferUri: string, imageUri: string, imageMimeType: string): GltfRootJson => ({
    asset: {
        version: '2.0',
        generator: 'vitest',
    },
    buffers: [
        {
            uri: bufferUri,
            byteLength: 42,
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
        {
            uri: imageUri,
            mimeType: imageMimeType,
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
                baseColorFactor: [1, 1, 1, 1],
                baseColorTexture: {
                    index: 0,
                },
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

const createTextureAsset = (payload: GltfCompressedTexturePayload): GltfTextureAsset => ({
    id: 'gltf/texture/0',
    textureIndex: 0,
    imageIndex: 0,
    sampler: {
        id: 'sampler/default',
        minFilter: FilterMode.LINEAR,
        magFilter: FilterMode.LINEAR,
        wrapS: WrapMode.REPEAT,
        wrapT: WrapMode.REPEAT,
    },
    payload,
    usageHints: Object.freeze(['baseColor']),
    transcode: {
        status: 'source',
    },
});

describe('glTF loaders texture transcoder', () => {
    beforeEach(() => {
        parseBasisMock.mockReset();
    });

    it('transcodes basisu payloads into runtime-ready compressed mip data', async () => {
        parseBasisMock.mockResolvedValue([
            [
                {
                    shape: 'texture-level',
                    width: 4,
                    height: 4,
                    compressed: true,
                    textureFormat: 'bc3-rgba-unorm',
                    data: new Uint8Array([1, 2, 3, 4]),
                },
                {
                    shape: 'texture-level',
                    width: 2,
                    height: 2,
                    compressed: true,
                    textureFormat: 'bc3-rgba-unorm',
                    data: new Uint8Array([5, 6]),
                },
            ],
        ] as Awaited<ReturnType<typeof BasisLoader.parse>>);

        const transcoder = createLoadersBasisGltfTextureTranscoder({
            supportedFormats: [TextureFormat.BC3_RGBA, TextureFormat.BC1_RGB],
            transcoderJsUrl: '/vendor/basis_transcoder.js',
            transcoderWasmUrl: '/vendor/basis_transcoder.wasm',
        });
        const texture = createTextureAsset({
            kind: 'compressed',
            bytes: new Uint8Array([9, 9, 9, 9]),
            container: 'basisu',
            uri: 'textures/albedo.basis',
            mimeType: 'image/basis',
        });

        expect(transcoder.canTranscode({ texture })).toBe(true);

        const result = await transcoder.transcode({ texture });

        expect(parseBasisMock).toHaveBeenCalledWith(
            expect.any(ArrayBuffer),
            expect.objectContaining({
                basis: expect.objectContaining({
                    containerFormat: 'basis',
                    module: 'transcoder',
                    supportedTextureFormats: ['bc3-rgba-unorm', 'bc1-rgb-unorm-webgl'],
                }),
                modules: expect.objectContaining({
                    'basis_transcoder.js': '/vendor/basis_transcoder.js',
                    'basis_transcoder.wasm': '/vendor/basis_transcoder.wasm',
                }),
            })
        );
        expect(result.state).toEqual({
            status: 'transcoded',
            transcoderId: 'gltf.texture.loaders.basis',
            targetFormat: TextureFormat.BC3_RGBA,
        });
        expect(result.runtimeFormat).toBe(TextureFormat.BC3_RGBA);
        expect(result.payload).toMatchObject({
            kind: 'compressed',
            container: 'basisu',
            targetFormat: TextureFormat.BC3_RGBA,
            width: 4,
            height: 4,
            levels: [
                {
                    level: 0,
                    width: 4,
                    height: 4,
                    byteOffset: 0,
                    byteLength: 4,
                },
                {
                    level: 1,
                    width: 2,
                    height: 2,
                    byteOffset: 4,
                    byteLength: 2,
                },
            ],
        });
        expect(Array.from(result.payload?.kind === 'compressed' ? result.payload.bytes : [])).toEqual([
            1, 2, 3, 4, 5, 6,
        ]);
    });

    it('skips unsupported loaders output formats with a diagnostic', async () => {
        parseBasisMock.mockResolvedValue([
            [
                {
                    shape: 'texture-level',
                    width: 4,
                    height: 4,
                    compressed: true,
                    textureFormat: 'etc2-rgba8unorm',
                    data: new Uint8Array([1, 2, 3, 4]),
                },
            ],
        ] as Awaited<ReturnType<typeof BasisLoader.parse>>);

        const transcoder = createLoadersBasisGltfTextureTranscoder({
            supportedFormats: [TextureFormat.BC3_RGBA],
        });
        const texture = createTextureAsset({
            kind: 'compressed',
            bytes: new Uint8Array([7, 7, 7, 7]),
            container: 'basisu',
        });

        const result = await transcoder.transcode({ texture });

        expect(result.state.status).toBe('skipped');
        expect(result.diagnostics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'gltf.texture.transcode.loaders.format-unsupported',
                }),
            ])
        );
    });

    it('applies the loaders-based transcoder through the gltf import stage', async () => {
        const ktx2 = createKtx2Texture([new Uint8Array([1, 2, 3, 4])], {
            supercompressionScheme: 1,
        });
        parseBasisMock.mockResolvedValue([
            [
                {
                    shape: 'texture-level',
                    width: 4,
                    height: 4,
                    compressed: true,
                    textureFormat: 'bc3-rgba-unorm',
                    data: new Uint8Array([10, 20, 30, 40]),
                },
            ],
        ] as Awaited<ReturnType<typeof BasisLoader.parse>>);

        const database = new AssetDatabase<GltfAssetSchema>({
            importers: [
                createGltfImporter({
                    resourceResolver: ({ uri }) => {
                        if (uri === 'mesh.bin') {
                            return {
                                uri,
                                bytes: createBinaryBlob(),
                                mimeType: 'application/octet-stream',
                            };
                        }

                        if (uri === 'albedo.ktx2') {
                            return {
                                uri,
                                bytes: ktx2,
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
                        createLoadersBasisGltfTextureTranscoder({
                            supportedFormats: [TextureFormat.BC3_RGBA],
                        }),
                    ]),
                }),
            ],
        });

        const receipt = await database.import({
            kind: 'text',
            data: JSON.stringify(createTriangleJson('mesh.bin', 'albedo.ktx2', 'image/ktx2')),
            uri: 'assets/model.gltf',
            mimeType: 'model/gltf+json',
        });

        const texture = receipt.assets.find((entry) => entry.kind === 'gltf.texture');

        expect(texture?.data.payload.kind).toBe('compressed');
        expect(texture?.data.runtimeFormat).toBe(TextureFormat.BC3_RGBA);
        expect(texture?.data.transcode).toEqual({
            status: 'transcoded',
            transcoderId: 'gltf.texture.loaders.basis',
            targetFormat: TextureFormat.BC3_RGBA,
        });
        expect(texture?.data.payload).toMatchObject({
            kind: 'compressed',
            container: 'ktx2',
            targetFormat: TextureFormat.BC3_RGBA,
            levels: [
                {
                    level: 0,
                    width: 4,
                    height: 4,
                    byteOffset: 0,
                    byteLength: 4,
                },
            ],
        });
    });
});