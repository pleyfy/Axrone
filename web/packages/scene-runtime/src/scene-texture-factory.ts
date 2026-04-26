import {
    TextureDimension,
    TextureFormat,
    TextureUsage,
    type ITexture,
    WebGLTextureManager,
} from '@axrone/render-webgl2';
import { SceneMaterialError } from './errors';
import type { SceneTextureResource } from './texture-registry';
import type { SceneTextureDefinition } from './types';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const encodeBase64 = (bytes: Uint8Array): string => {
    let result = '';

    for (let index = 0; index < bytes.length; index += 3) {
        const byte0 = bytes[index] ?? 0;
        const byte1 = bytes[index + 1] ?? 0;
        const byte2 = bytes[index + 2] ?? 0;
        const block = (byte0 << 16) | (byte1 << 8) | byte2;

        result +=
            BASE64_ALPHABET[(block >>> 18) & 63] +
            BASE64_ALPHABET[(block >>> 12) & 63] +
            (index + 1 < bytes.length ? BASE64_ALPHABET[(block >>> 6) & 63] : '=') +
            (index + 2 < bytes.length ? BASE64_ALPHABET[block & 63] : '=');
    }

    return result;
};

const clampByte = (value: number): number => {
    const normalized = value <= 1 && value >= 0 ? value * 255 : value;
    return Math.max(0, Math.min(255, Math.round(normalized)));
};

const calculateMipLevels = (width: number, height: number): number =>
    Math.max(1, Math.floor(Math.log2(Math.max(width, height))) + 1);

const inferTextureChannels = (format: TextureFormat): 1 | 2 | 3 | 4 => {
    const value = String(format);

    if (value.includes('RGBA')) {
        return 4;
    }

    if (value.includes('RGB')) {
        return 3;
    }

    if (value.includes('RG')) {
        return 2;
    }

    return 1;
};

const isFloatTextureFormat = (format: TextureFormat): boolean => {
    const value = String(format);
    return value.includes('16F') || value.includes('32F');
};

const createSolidTextureData = (
    color: readonly [number, number, number, number],
    width: number,
    height: number
): Uint8Array => {
    const data = new Uint8Array(width * height * 4);
    const red = clampByte(color[0]);
    const green = clampByte(color[1]);
    const blue = clampByte(color[2]);
    const alpha = clampByte(color[3]);

    for (let index = 0; index < data.length; index += 4) {
        data[index] = red;
        data[index + 1] = green;
        data[index + 2] = blue;
        data[index + 3] = alpha;
    }

    return data;
};

const createCheckerTextureData = (
    size: number,
    colorA: readonly [number, number, number, number],
    colorB: readonly [number, number, number, number]
): Uint8Array => {
    const data = new Uint8Array(size * size * 4);
    const a = colorA.map((value) => clampByte(value)) as number[];
    const b = colorB.map((value) => clampByte(value)) as number[];

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const offset = (y * size + x) * 4;
            const source = (x + y) % 2 === 0 ? a : b;

            data[offset] = source[0];
            data[offset + 1] = source[1];
            data[offset + 2] = source[2];
            data[offset + 3] = source[3];
        }
    }

    return data;
};

const createRawTextureData = (
    format: TextureFormat,
    width: number,
    height: number,
    sourceData: readonly number[],
    channels?: 1 | 2 | 3 | 4
): ArrayBufferView => {
    const channelCount = channels ?? inferTextureChannels(format);
    const expectedLength = width * height * channelCount;
    const values =
        sourceData.length >= expectedLength
            ? sourceData.slice(0, expectedLength)
            : [...sourceData, ...new Array(expectedLength - sourceData.length).fill(0)];

    if (isFloatTextureFormat(format)) {
        return new Float32Array(values);
    }

    return new Uint8Array(values.map((entry) => clampByte(entry)));
};

export interface SceneTextureFactoryOptions {
    readonly textureManager: WebGLTextureManager;
}

export class SceneTextureFactory {
    constructor(private readonly _options: SceneTextureFactoryOptions) {}

    async create(definition: SceneTextureDefinition): Promise<SceneTextureResource> {
        const format = definition.format ?? TextureFormat.RGBA8;
        const generateMipmaps = definition.generateMipmaps ?? true;
        const mipLevelsFor = (width: number, height: number): number =>
            generateMipmaps ? calculateMipLevels(width, height) : 1;

        let texture: ITexture;

        switch (definition.source.kind) {
            case 'color': {
                const width = definition.source.width ?? 1;
                const height = definition.source.height ?? 1;
                texture = this._options.textureManager.createTexture(
                    {
                        width,
                        height,
                        format,
                        colorSpace: definition.colorSpace,
                        dimension: TextureDimension.TEXTURE_2D,
                        usage: TextureUsage.STATIC,
                        mipLevels: mipLevelsFor(width, height),
                    },
                    createSolidTextureData(definition.source.color, width, height)
                );
                break;
            }
            case 'checker': {
                const size = definition.source.size ?? 8;
                texture = this._options.textureManager.createTexture(
                    {
                        width: size,
                        height: size,
                        format,
                        colorSpace: definition.colorSpace,
                        dimension: TextureDimension.TEXTURE_2D,
                        usage: TextureUsage.STATIC,
                        mipLevels: mipLevelsFor(size, size),
                    },
                    createCheckerTextureData(
                        size,
                        definition.source.colorA ?? [0.08, 0.1, 0.12, 1],
                        definition.source.colorB ?? [0.88, 0.92, 0.96, 1]
                    )
                );
                break;
            }
            case 'data': {
                texture = this._options.textureManager.createTexture(
                    {
                        width: definition.source.width,
                        height: definition.source.height,
                        format,
                        colorSpace: definition.colorSpace,
                        dimension: TextureDimension.TEXTURE_2D,
                        usage: TextureUsage.STATIC,
                        mipLevels: mipLevelsFor(
                            definition.source.width,
                            definition.source.height
                        ),
                    },
                    createRawTextureData(
                        format,
                        definition.source.width,
                        definition.source.height,
                        definition.source.data,
                        definition.source.channels
                    )
                );
                break;
            }
            case 'url': {
                const image = await this._loadImage(
                    definition.source.url,
                    definition.source.crossOrigin
                );
                texture = this._options.textureManager.createTexture(
                    {
                        width: image.width,
                        height: image.height,
                        format,
                        colorSpace: definition.colorSpace,
                        dimension: TextureDimension.TEXTURE_2D,
                        usage: TextureUsage.STATIC,
                        mipLevels: mipLevelsFor(image.width, image.height),
                    },
                    image
                );
                break;
            }
            case 'bytes': {
                const image = await this._loadImageSourceFromBytes(
                    definition.source.bytes,
                    definition.source.mimeType,
                    definition.source.uri
                );
                try {
                    texture = this._options.textureManager.createTexture(
                        {
                            width: image.width,
                            height: image.height,
                            format,
                            colorSpace: definition.colorSpace,
                            dimension: TextureDimension.TEXTURE_2D,
                            usage: TextureUsage.STATIC,
                            mipLevels: mipLevelsFor(image.width, image.height),
                        },
                        image
                    );
                } finally {
                    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
                        image.close();
                    }
                }
                break;
            }
            case 'compressed': {
                if (definition.format === undefined) {
                    throw new SceneMaterialError(
                        `Compressed texture '${definition.id}' must provide an explicit texture format`
                    );
                }

                const levels = [...definition.source.levels].sort(
                    (left, right) => left.level - right.level
                );
                const topLevel = levels[0];
                if (!topLevel) {
                    throw new SceneMaterialError(
                        `Compressed texture '${definition.id}' must include at least one mip level`
                    );
                }

                const compressedBytes =
                    definition.source.bytes instanceof Uint8Array
                        ? definition.source.bytes
                        : new Uint8Array(definition.source.bytes);
                const mipLevelCount = levels.reduce(
                    (count, level) => Math.max(count, level.level + 1),
                    1
                );

                texture = this._options.textureManager.createTexture({
                    width: topLevel.width,
                    height: topLevel.height,
                    format,
                    colorSpace: definition.colorSpace,
                    dimension: TextureDimension.TEXTURE_2D,
                    usage: TextureUsage.STATIC,
                    mipLevels: mipLevelCount,
                });

                for (const level of levels) {
                    const start = level.byteOffset;
                    const end = start + level.byteLength;
                    if (start < 0 || end > compressedBytes.byteLength) {
                        throw new SceneMaterialError(
                            `Compressed texture '${definition.id}' mip ${level.level} exceeds its payload bounds`
                        );
                    }

                    texture.setData(compressedBytes.subarray(start, end), {
                        mipLevel: level.level,
                        width: level.width,
                        height: level.height,
                    });
                }
                break;
            }
        }

        if (generateMipmaps && texture.mipLevels > 1 && texture.isCompressed === false) {
            texture.generateMipmaps();
        }

        return {
            id: definition.id,
            texture,
            width: texture.width,
            height: texture.height,
            samplerId: definition.samplerId ?? null,
        };
    }

    private async _loadImage(url: string, crossOrigin?: string | null): Promise<HTMLImageElement> {
        return await new Promise((resolve, reject) => {
            const image = new Image();

            if (crossOrigin !== undefined) {
                image.crossOrigin = crossOrigin ?? '';
            } else if (url.startsWith('http')) {
                image.crossOrigin = 'anonymous';
            }

            image.onload = () => resolve(image);
            image.onerror = () =>
                reject(new SceneMaterialError(`Failed to load texture '${url}'`));
            image.src = url;
        });
    }

    private async _loadImageFromBytes(
        bytes: readonly number[] | Uint8Array,
        mimeType: string,
        uri?: string
    ): Promise<HTMLImageElement> {
        if (mimeType.startsWith('image/') === false) {
            throw new SceneMaterialError(
                `Cannot decode texture bytes${uri ? ` for '${uri}'` : ''} because mime type '${mimeType}' is not an image`
            );
        }

        const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const blob = new Blob([data], { type: mimeType });
        const canCreateObjectUrl =
            typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
        const objectUrl = canCreateObjectUrl
            ? URL.createObjectURL(blob)
            : `data:${mimeType};base64,${encodeBase64(data)}`;

        try {
            return await this._loadImage(objectUrl);
        } finally {
            if (canCreateObjectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        }
    }

    private async _loadImageSourceFromBytes(
        bytes: readonly number[] | Uint8Array,
        mimeType: string,
        uri?: string
    ): Promise<HTMLImageElement | ImageBitmap> {
        if (mimeType.startsWith('image/') === false) {
            throw new SceneMaterialError(
                `Cannot decode texture bytes${uri ? ` for '${uri}'` : ''} because mime type '${mimeType}' is not an image`
            );
        }

        const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        if (typeof createImageBitmap === 'function') {
            return await createImageBitmap(new Blob([data], { type: mimeType }));
        }

        return await this._loadImageFromBytes(data, mimeType, uri);
    }
}
