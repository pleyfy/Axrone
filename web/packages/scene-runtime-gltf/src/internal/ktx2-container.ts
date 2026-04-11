import type { GltfTextureMipLevel } from '@axrone/asset-gltf';
import { GltfContainerError } from '@axrone/asset-gltf';
import { TextureFormat } from '@axrone/render-webgl2';

const KTX2_IDENTIFIER = new Uint8Array([
    0xab,
    0x4b,
    0x54,
    0x58,
    0x20,
    0x32,
    0x30,
    0xbb,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
]);
const KTX2_HEADER_LENGTH = 80;
const KTX2_LEVEL_INDEX_ENTRY_LENGTH = 24;

const VULKAN_FORMAT_TO_TEXTURE_FORMAT = new Map<number, TextureFormat>([
    [131, TextureFormat.BC1_RGB],
    [133, TextureFormat.BC1_RGBA],
    [135, TextureFormat.BC2_RGBA],
    [137, TextureFormat.BC3_RGBA],
    [139, TextureFormat.BC4_R],
    [141, TextureFormat.BC5_RG],
    [143, TextureFormat.BC6H_RGB_UF16],
    [144, TextureFormat.BC6H_RGB_SF16],
    [145, TextureFormat.BC7_RGBA],
    [157, TextureFormat.ASTC_4x4],
    [159, TextureFormat.ASTC_5x4],
    [161, TextureFormat.ASTC_5x5],
    [163, TextureFormat.ASTC_6x5],
    [165, TextureFormat.ASTC_6x6],
    [167, TextureFormat.ASTC_8x5],
    [169, TextureFormat.ASTC_8x6],
    [171, TextureFormat.ASTC_8x8],
    [173, TextureFormat.ASTC_10x5],
    [175, TextureFormat.ASTC_10x6],
    [177, TextureFormat.ASTC_10x8],
    [179, TextureFormat.ASTC_10x10],
    [181, TextureFormat.ASTC_12x10],
    [183, TextureFormat.ASTC_12x12],
]);

export interface ParsedKtx2Texture {
    readonly vkFormat: number;
    readonly width: number;
    readonly height: number;
    readonly levelCount: number;
    readonly supercompressionScheme: number;
    readonly levels: readonly GltfTextureMipLevel[];
}

const readUint64 = (view: DataView, byteOffset: number): number => {
    const low = view.getUint32(byteOffset, true);
    const high = view.getUint32(byteOffset + 4, true);
    return low + high * 0x1_0000_0000;
};

const assertKtx2Identifier = (bytes: Uint8Array): void => {
    if (bytes.byteLength < KTX2_HEADER_LENGTH) {
        throw new GltfContainerError('KTX2 payload is too small');
    }

    for (let index = 0; index < KTX2_IDENTIFIER.length; index += 1) {
        if (bytes[index] !== KTX2_IDENTIFIER[index]) {
            throw new GltfContainerError('KTX2 identifier is invalid');
        }
    }
};

export const parseKtx2Texture = (bytes: Uint8Array): ParsedKtx2Texture => {
    assertKtx2Identifier(bytes);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const vkFormat = view.getUint32(12, true);
    const width = view.getUint32(20, true);
    const height = view.getUint32(24, true);
    const depth = view.getUint32(28, true);
    const layerCount = view.getUint32(32, true);
    const faceCount = view.getUint32(36, true);
    const levelCount = Math.max(1, view.getUint32(40, true));
    const supercompressionScheme = view.getUint32(44, true);

    if (width <= 0 || height <= 0) {
        throw new GltfContainerError('KTX2 texture dimensions must be positive');
    }

    if (depth > 1) {
        throw new GltfContainerError('KTX2 3D textures are not supported by the glTF scene bridge');
    }

    if (layerCount > 1) {
        throw new GltfContainerError('KTX2 texture arrays are not supported by the glTF scene bridge');
    }

    if (faceCount > 1) {
        throw new GltfContainerError('KTX2 cubemaps are not supported by the glTF scene bridge');
    }

    const levelIndexOffset = KTX2_HEADER_LENGTH;
    const levelIndexLength = levelCount * KTX2_LEVEL_INDEX_ENTRY_LENGTH;
    if (levelIndexOffset + levelIndexLength > bytes.byteLength) {
        throw new GltfContainerError('KTX2 level index exceeds the payload length');
    }

    const levels: GltfTextureMipLevel[] = [];
    for (let level = 0; level < levelCount; level += 1) {
        const entryOffset = levelIndexOffset + level * KTX2_LEVEL_INDEX_ENTRY_LENGTH;
        const byteOffset = readUint64(view, entryOffset);
        const byteLength = readUint64(view, entryOffset + 8);

        if (byteOffset < 0 || byteLength <= 0 || byteOffset + byteLength > bytes.byteLength) {
            throw new GltfContainerError(`KTX2 mip level ${level} exceeds the payload length`);
        }

        levels.push(
            Object.freeze({
                level,
                width: Math.max(1, width >> level),
                height: Math.max(1, height >> level),
                byteOffset,
                byteLength,
            })
        );
    }

    return Object.freeze({
        vkFormat,
        width,
        height,
        levelCount,
        supercompressionScheme,
        levels: Object.freeze(levels),
    });
};

export const inferTextureFormatFromKtx2 = (bytes: Uint8Array): TextureFormat | undefined => {
    const parsed = parseKtx2Texture(bytes);
    return VULKAN_FORMAT_TO_TEXTURE_FORMAT.get(parsed.vkFormat);
};