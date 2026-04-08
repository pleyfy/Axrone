import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BasisLoader } from '@loaders.gl/textures';
import {
    createLoadersBasisGltfTextureTranscoder,
    type GltfCompressedTexturePayload,
    type GltfTextureAsset,
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
});