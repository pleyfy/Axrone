import { BASIS_EXTERNAL_LIBRARIES, BasisLoader } from '@loaders.gl/textures';
import type { TextureFormat as LoadersTextureFormat } from '@loaders.gl/textures';
import { inferTextureFormatFromKtx2, parseKtx2Texture } from './internal/ktx2-container';
import type {
    GltfCompressedTexturePayload,
    GltfTextureMipLevel,
    GltfTextureTranscodeResult,
    GltfTextureTranscoder,
} from './types';
import { TextureFormat } from '../../renderer/webgl2/texture/interfaces';

type BasisParseResult = Awaited<ReturnType<typeof BasisLoader.parse>>;
type BasisTextureLevel = BasisParseResult[number][number];

const AXRONE_TO_LOADERS_TEXTURE_FORMAT = new Map<TextureFormat, LoadersTextureFormat>([
    [TextureFormat.BC1_RGB, 'bc1-rgb-unorm-webgl'],
    [TextureFormat.BC3_RGBA, 'bc3-rgba-unorm'],
    [TextureFormat.BC4_R, 'bc4-r-unorm'],
    [TextureFormat.BC5_RG, 'bc5-rg-unorm'],
    [TextureFormat.BC7_RGBA, 'bc7-rgba-unorm'],
    [TextureFormat.ASTC_4x4, 'astc-4x4-unorm'],
]);

const LOADERS_TO_AXRONE_TEXTURE_FORMAT = new Map<LoadersTextureFormat, TextureFormat>([
    ['bc1-rgb-unorm-webgl', TextureFormat.BC1_RGB],
    ['bc3-rgba-unorm', TextureFormat.BC3_RGBA],
    ['bc4-r-unorm', TextureFormat.BC4_R],
    ['bc5-rg-unorm', TextureFormat.BC5_RG],
    ['bc7-rgba-unorm', TextureFormat.BC7_RGBA],
    ['astc-4x4-unorm', TextureFormat.ASTC_4x4],
]);

const createDiagnosticResult = (
    transcoderId: string,
    code: string,
    message: string,
    targetFormat?: TextureFormat
): GltfTextureTranscodeResult => ({
    state: {
        status: 'skipped',
        transcoderId,
        reason: message,
        ...(targetFormat ? { targetFormat } : {}),
    },
    diagnostics: [
        {
            level: 'warning',
            code,
            message,
        },
    ],
});

const getTextureBytes = (level: BasisTextureLevel): Uint8Array =>
    new Uint8Array(level.data.buffer, level.data.byteOffset, level.data.byteLength);

const packTextureLevels = (
    levels: readonly BasisTextureLevel[]
): { readonly bytes: Uint8Array; readonly mipLevels: readonly GltfTextureMipLevel[] } => {
    const packedLevels: GltfTextureMipLevel[] = [];
    const totalLength = levels.reduce((sum, level) => sum + level.data.byteLength, 0);
    const bytes = new Uint8Array(totalLength);
    let byteOffset = 0;

    for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
        const level = levels[levelIndex]!;
        const levelBytes = getTextureBytes(level);
        bytes.set(levelBytes, byteOffset);
        packedLevels.push(
            Object.freeze({
                level: levelIndex,
                width: level.width,
                height: level.height,
                byteOffset,
                byteLength: levelBytes.byteLength,
            })
        );
        byteOffset += levelBytes.byteLength;
    }

    return {
        bytes,
        mipLevels: Object.freeze(packedLevels),
    };
};

const isSupercompressedOrRuntimeUnknownKtx2 = (payload: GltfCompressedTexturePayload): boolean => {
    try {
        const parsed = parseKtx2Texture(payload.bytes);
        return parsed.supercompressionScheme !== 0 || inferTextureFormatFromKtx2(payload.bytes) === undefined;
    } catch {
        return false;
    }
};

export interface LoadersBasisGltfTextureTranscoderOptions {
    readonly id?: string;
    readonly priority?: number;
    readonly supportedFormats: readonly TextureFormat[];
    readonly transcoderJsUrl?: string;
    readonly transcoderWasmUrl?: string;
    readonly useLocalLibraries?: boolean;
}

export const createLoadersBasisGltfTextureTranscoder = (
    options: LoadersBasisGltfTextureTranscoderOptions
): GltfTextureTranscoder => {
    const transcoderId = options.id ?? 'gltf.texture.loaders.basis';
    const supportedTextureFormats = options.supportedFormats.map((format) => {
        const resolved = AXRONE_TO_LOADERS_TEXTURE_FORMAT.get(format);
        if (!resolved) {
            throw new Error(
                `Loaders-based glTF texture transcoder does not support target format '${format}'`
            );
        }
        return resolved;
    });

    if (supportedTextureFormats.length === 0) {
        throw new Error('Loaders-based glTF texture transcoder requires at least one supported target format');
    }

    const libraryModules = {
        ...(options.transcoderJsUrl
            ? { [BASIS_EXTERNAL_LIBRARIES.TRANSCODER]: options.transcoderJsUrl }
            : {}),
        ...(options.transcoderWasmUrl
            ? { [BASIS_EXTERNAL_LIBRARIES.TRANSCODER_WASM]: options.transcoderWasmUrl }
            : {}),
    };

    return {
        id: transcoderId,
        priority: options.priority ?? 100,
        canTranscode: ({ texture }) => {
            if (texture.transcode.status === 'transcoded') {
                return false;
            }

            const payload = texture.payload;
            if (payload.kind !== 'compressed') {
                return false;
            }

            if (payload.container === 'basisu') {
                return true;
            }

            if (payload.container !== 'ktx2') {
                return false;
            }

            if (payload.targetFormat && payload.levels?.length) {
                return false;
            }

            return isSupercompressedOrRuntimeUnknownKtx2(payload);
        },
        transcode: async ({ texture, signal }) => {
            const payload = texture.payload;
            if (payload.kind !== 'compressed') {
                return createDiagnosticResult(
                    transcoderId,
                    'gltf.texture.transcode.loaders.invalid-source',
                    `Texture '${texture.id}' is not a compressed glTF payload and cannot be transcoded by '${transcoderId}'`
                );
            }

            if (signal?.aborted) {
                return {
                    state: {
                        status: 'skipped',
                        transcoderId,
                        reason: 'Texture transcode aborted',
                    },
                };
            }

            const data = new Uint8Array(payload.bytes).buffer as ArrayBuffer;
            const parsed = await BasisLoader.parse(data, {
                basis: {
                    containerFormat: payload.container === 'basisu' ? 'basis' : 'ktx2',
                    module: 'transcoder',
                    supportedTextureFormats,
                },
                ...(options.useLocalLibraries !== undefined
                    ? { useLocalLibraries: options.useLocalLibraries }
                    : {}),
                ...(Object.keys(libraryModules).length > 0 ? { modules: libraryModules } : {}),
            });

            if (signal?.aborted) {
                return {
                    state: {
                        status: 'skipped',
                        transcoderId,
                        reason: 'Texture transcode aborted',
                    },
                };
            }

            if (parsed.length !== 1 || parsed[0]?.length === 0) {
                return createDiagnosticResult(
                    transcoderId,
                    'gltf.texture.transcode.loaders.multi-image-unsupported',
                    `Texture '${texture.id}' transcoded into an unsupported multi-image payload`
                );
            }

            const levels = parsed[0]!;
            const firstFormat = levels[0]?.textureFormat;
            if (!firstFormat) {
                return createDiagnosticResult(
                    transcoderId,
                    'gltf.texture.transcode.loaders.format-missing',
                    `Texture '${texture.id}' transcoded without a runtime texture format`
                );
            }

            const targetFormat = LOADERS_TO_AXRONE_TEXTURE_FORMAT.get(firstFormat);
            if (!targetFormat) {
                return createDiagnosticResult(
                    transcoderId,
                    'gltf.texture.transcode.loaders.format-unsupported',
                    `Texture '${texture.id}' transcoded into unsupported runtime format '${firstFormat}'`
                );
            }

            for (const level of levels) {
                if (!level.compressed) {
                    return createDiagnosticResult(
                        transcoderId,
                        'gltf.texture.transcode.loaders.uncompressed-output',
                        `Texture '${texture.id}' transcoded into uncompressed output, which this P1 runtime path does not accept`,
                        targetFormat
                    );
                }

                if (level.textureFormat !== firstFormat) {
                    return createDiagnosticResult(
                        transcoderId,
                        'gltf.texture.transcode.loaders.format-mismatch',
                        `Texture '${texture.id}' produced inconsistent mip formats during transcode`,
                        targetFormat
                    );
                }
            }

            const packed = packTextureLevels(levels);

            return {
                payload: {
                    ...payload,
                    bytes: packed.bytes,
                    levels: packed.mipLevels,
                    targetFormat,
                    width: levels[0]!.width,
                    height: levels[0]!.height,
                },
                runtimeFormat: targetFormat,
                state: {
                    status: 'transcoded',
                    transcoderId,
                    targetFormat,
                },
            };
        },
    };
};