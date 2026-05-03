import { Vec2, Vec3, Vec4 } from '@axrone/numeric';
import { ByteBuffer } from '@axrone/memory';
import type { IBindableTarget } from '../interfaces';

export const enum TextureDimension {
    TEXTURE_1D = '1D',
    TEXTURE_2D = '2D',
    TEXTURE_3D = '3D',
    TEXTURE_CUBE = 'CUBE',
    TEXTURE_2D_ARRAY = '2D_ARRAY',
    TEXTURE_CUBE_ARRAY = 'CUBE_ARRAY',
}

export const enum TextureFormat {
    R8 = 'R8',
    RG8 = 'RG8',
    RGB8 = 'RGB8',
    RGBA8 = 'RGBA8',

    R16F = 'R16F',
    RG16F = 'RG16F',
    RGB16F = 'RGB16F',
    RGBA16F = 'RGBA16F',

    R32F = 'R32F',
    RG32F = 'RG32F',
    RGB32F = 'RGB32F',
    RGBA32F = 'RGBA32F',

    R8I = 'R8I',
    RG8I = 'RG8I',
    RGB8I = 'RGB8I',
    RGBA8I = 'RGBA8I',

    R16I = 'R16I',
    RG16I = 'RG16I',
    RGB16I = 'RGB16I',
    RGBA16I = 'RGBA16I',

    R32I = 'R32I',
    RG32I = 'RG32I',
    RGB32I = 'RGB32I',
    RGBA32I = 'RGBA32I',

    R8UI = 'R8UI',
    RG8UI = 'RG8UI',
    RGB8UI = 'RGB8UI',
    RGBA8UI = 'RGBA8UI',

    R16UI = 'R16UI',
    RG16UI = 'RG16UI',
    RGB16UI = 'RGB16UI',
    RGBA16UI = 'RGBA16UI',

    R32UI = 'R32UI',
    RG32UI = 'RG32UI',
    RGB32UI = 'RGB32UI',
    RGBA32UI = 'RGBA32UI',

    DEPTH_COMPONENT16 = 'DEPTH_COMPONENT16',
    DEPTH_COMPONENT24 = 'DEPTH_COMPONENT24',
    DEPTH_COMPONENT32F = 'DEPTH_COMPONENT32F',

    DEPTH24_STENCIL8 = 'DEPTH24_STENCIL8',
    DEPTH32F_STENCIL8 = 'DEPTH32F_STENCIL8',

    BC1_RGB = 'BC1_RGB',
    BC1_RGBA = 'BC1_RGBA',
    BC2_RGBA = 'BC2_RGBA',
    BC3_RGBA = 'BC3_RGBA',
    BC4_R = 'BC4_R',
    BC5_RG = 'BC5_RG',
    BC6H_RGB_UF16 = 'BC6H_RGB_UF16',
    BC6H_RGB_SF16 = 'BC6H_RGB_SF16',
    BC7_RGBA = 'BC7_RGBA',

    ASTC_4x4 = 'ASTC_4x4',
    ASTC_5x4 = 'ASTC_5x4',
    ASTC_5x5 = 'ASTC_5x5',
    ASTC_6x5 = 'ASTC_6x5',
    ASTC_6x6 = 'ASTC_6x6',
    ASTC_8x5 = 'ASTC_8x5',
    ASTC_8x6 = 'ASTC_8x6',
    ASTC_8x8 = 'ASTC_8x8',
    ASTC_10x5 = 'ASTC_10x5',
    ASTC_10x6 = 'ASTC_10x6',
    ASTC_10x8 = 'ASTC_10x8',
    ASTC_10x10 = 'ASTC_10x10',
    ASTC_12x10 = 'ASTC_12x10',
    ASTC_12x12 = 'ASTC_12x12',
}

export const enum FilterMode {
    NEAREST = 'NEAREST',
    LINEAR = 'LINEAR',
    NEAREST_MIPMAP_NEAREST = 'NEAREST_MIPMAP_NEAREST',
    LINEAR_MIPMAP_NEAREST = 'LINEAR_MIPMAP_NEAREST',
    NEAREST_MIPMAP_LINEAR = 'NEAREST_MIPMAP_LINEAR',
    LINEAR_MIPMAP_LINEAR = 'LINEAR_MIPMAP_LINEAR',
}

export const enum WrapMode {
    REPEAT = 'REPEAT',
    CLAMP_TO_EDGE = 'CLAMP_TO_EDGE',
    CLAMP_TO_BORDER = 'CLAMP_TO_BORDER',
    MIRRORED_REPEAT = 'MIRRORED_REPEAT',
}

export const enum TextureUsage {
    STATIC = 'STATIC',
    DYNAMIC = 'DYNAMIC',
    STREAM = 'STREAM',
    RENDER_TARGET = 'RENDER_TARGET',
    DEPTH_BUFFER = 'DEPTH_BUFFER',
    COMPUTE = 'COMPUTE',
}

export const enum ColorSpace {
    LINEAR = 'LINEAR',
    SRGB = 'SRGB',
    HDR10 = 'HDR10',
    REC2020 = 'REC2020',
}

export interface ITextureCreateOptions {
    readonly width: number;
    readonly height: number;
    readonly depth?: number;
    readonly format: TextureFormat;
    readonly dimension: TextureDimension;
    readonly mipLevels?: number;
    readonly arrayLayers?: number;
    readonly samples?: number;
    readonly usage: TextureUsage;
    readonly colorSpace?: ColorSpace;
    readonly label?: string;
}

export interface ITextureSamplerOptions {
    readonly minFilter: FilterMode;
    readonly magFilter: FilterMode;
    readonly wrapS: WrapMode;
    readonly wrapT: WrapMode;
    readonly wrapR?: WrapMode;
    readonly borderColor?: Vec4;
    readonly maxAnisotropy?: number;
    readonly compareMode?: 'NONE' | 'COMPARE_REF_TO_TEXTURE';
    readonly compareFunc?:
        | 'NEVER'
        | 'LESS'
        | 'EQUAL'
        | 'LEQUAL'
        | 'GREATER'
        | 'NOTEQUAL'
        | 'GEQUAL'
        | 'ALWAYS';
    readonly minLod?: number;
    readonly maxLod?: number;
    readonly lodBias?: number;
}

export type TextureDataSource =
    | ArrayBufferView
    | ImageData
    | HTMLImageElement
    | HTMLCanvasElement
    | HTMLVideoElement
    | ImageBitmap
    | ByteBuffer
    | null;

export interface ITextureSubresource {
    readonly mipLevel: number;
    readonly arrayLayer?: number;
    readonly x?: number;
    readonly y?: number;
    readonly z?: number;
    readonly width?: number;
    readonly height?: number;
    readonly depth?: number;
}

export interface ITexture extends IBindableTarget {
    readonly id: string;
    readonly nativeHandle: WebGLTexture;
    readonly dimension: TextureDimension;
    readonly format: TextureFormat;
    readonly width: number;
    readonly height: number;
    readonly depth: number;
    readonly mipLevels: number;
    readonly arrayLayers: number;
    readonly samples: number;
    readonly usage: TextureUsage;
    readonly colorSpace: ColorSpace;
    readonly label: string | null;
    readonly isCompressed: boolean;
    readonly bytesPerPixel: number;
    readonly totalMemoryUsage: number;
    readonly isDisposed: boolean;

    setData(data: TextureDataSource, subresource?: ITextureSubresource): void;
    getData(subresource?: ITextureSubresource): Promise<ArrayBufferView>;
    copyTo(
        destination: ITexture,
        sourceRegion?: ITextureSubresource,
        destRegion?: ITextureSubresource
    ): void;

    generateMipmaps(): void;
    hasMipmaps(): boolean;

    resize(width: number, height: number, depth?: number): void;
    clone(): ITexture;

    dispose(): void;
}

export interface ITextureSampler extends IBindableTarget {
    readonly id: string;
    readonly nativeHandle: WebGLSampler;
    readonly options: ITextureSamplerOptions;
    readonly isDisposed: boolean;

    dispose(): void;
}

export interface ITextureManager {
    createTexture(options: ITextureCreateOptions, data?: TextureDataSource): ITexture;
    createTexture2D(
        width: number,
        height: number,
        format: TextureFormat,
        data?: TextureDataSource
    ): ITexture;
    createTexture3D(
        width: number,
        height: number,
        depth: number,
        format: TextureFormat,
        data?: TextureDataSource
    ): ITexture;
    createTextureCube(size: number, format: TextureFormat, data?: TextureDataSource[]): ITexture;
    createTextureArray(
        width: number,
        height: number,
        layers: number,
        format: TextureFormat,
        data?: TextureDataSource[]
    ): ITexture;

    createSampler(options: ITextureSamplerOptions): ITextureSampler;
    getDefaultSampler(filterMode: FilterMode, wrapMode: WrapMode): ITextureSampler;

    loadFromFile(path: string, options?: Partial<ITextureCreateOptions>): Promise<ITexture>;
    loadFromURL(url: string, options?: Partial<ITextureCreateOptions>): Promise<ITexture>;
    loadCubeFromFiles(paths: [string, string, string, string, string, string]): Promise<ITexture>;

    getTexture(id: string): ITexture | null;
    cacheTexture(id: string, texture: ITexture): void;
    removeCachedTexture(id: string): boolean;
    clearCache(): void;

    getWhiteTexture(): ITexture;
    getBlackTexture(): ITexture;
    getNormalTexture(): ITexture;
    getCheckerboardTexture(): ITexture;

    getStats(): ITextureManagerStats;
    optimizeMemory(): void;
    dispose(): void;
}

export interface ITextureManagerStats {
    readonly totalTextures: number;
    readonly totalMemoryUsage: number;
    readonly texturesByFormat: Map<TextureFormat, number>;
    readonly texturesByDimension: Map<TextureDimension, number>;
    readonly texturesByUsage: Map<TextureUsage, number>;
    readonly cacheHitRate: number;
    readonly averageTextureSize: number;
    readonly largestTexture: ITexture | null;
}

export interface ITextureBuilder {
    dimension(dim: TextureDimension): ITextureBuilder;
    size(width: number, height: number, depth?: number): ITextureBuilder;
    format(fmt: TextureFormat): ITextureBuilder;
    mipLevels(levels: number): ITextureBuilder;
    arrayLayers(layers: number): ITextureBuilder;
    samples(count: number): ITextureBuilder;
    usage(use: TextureUsage): ITextureBuilder;
    colorSpace(space: ColorSpace): ITextureBuilder;
    label(name: string): ITextureBuilder;
    data(source: TextureDataSource): ITextureBuilder;

    filtering(min: FilterMode, mag: FilterMode): ITextureBuilder;
    wrapping(s: WrapMode, t: WrapMode, r?: WrapMode): ITextureBuilder;
    anisotropy(level: number): ITextureBuilder;
    borderColor(color: Vec4): ITextureBuilder;

    build(): ITexture;
}

export interface ITextureAtlasEntry {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly rotated: boolean;
    readonly trimmed: boolean;
    readonly sourceSize: Vec2;
    readonly spriteSourceSize: { x: number; y: number; w: number; h: number };
    readonly uvBounds: { u0: number; v0: number; u1: number; v1: number };
}

export interface ITextureAtlas {
    readonly texture: ITexture;
    readonly entries: Map<string, ITextureAtlasEntry>;
    readonly totalEntries: number;
    readonly efficiency: number;

    getEntry(id: string): ITextureAtlasEntry | null;
    hasEntry(id: string): boolean;
    getUVBounds(id: string): Vec4 | null;

    addTexture(id: string, source: TextureDataSource): ITextureAtlasEntry | null;
    removeTexture(id: string): boolean;
    optimize(): void;
}

export interface ITextureCompressor {
    readonly supportedFormats: readonly TextureFormat[];

    compress(
        source: ITexture,
        targetFormat: TextureFormat,
        quality?: number
    ): Promise<ArrayBufferView>;
    decompress(data: ArrayBufferView, format: TextureFormat): Promise<ArrayBufferView>;

    estimateSize(width: number, height: number, format: TextureFormat): number;
    isFormatSupported(format: TextureFormat): boolean;
}

export interface ITextureStreamingOptions {
    readonly maxConcurrentLoads: number;
    readonly memoryBudget: number;
    readonly priorityThreshold: number;
    readonly enableCompression: boolean;
    readonly compressionQuality: number;
}

export interface ITextureStreaming {
    readonly options: ITextureStreamingOptions;
    readonly isEnabled: boolean;
    readonly queuedRequests: number;
    readonly memoryUsage: number;

    requestTexture(id: string, priority: number): Promise<ITexture>;
    preloadTexture(id: string): Promise<void>;
    releaseTexture(id: string): void;

    setMemoryBudget(bytes: number): void;
    optimize(): void;

    enable(): void;
    disable(): void;
}

export class TextureError extends Error {
    constructor(
        message: string,
        public readonly code: TextureErrorCode,
        public readonly textureId?: string,
        public readonly cause?: Error
    ) {
        super(`[Texture] ${code}: ${message}`);
        this.name = 'TextureError';
    }
}

export const enum TextureErrorCode {
    INVALID_DIMENSIONS = 'INVALID_DIMENSIONS',
    UNSUPPORTED_FORMAT = 'UNSUPPORTED_FORMAT',
    OUT_OF_MEMORY = 'OUT_OF_MEMORY',
    INVALID_DATA = 'INVALID_DATA',
    ALREADY_DISPOSED = 'ALREADY_DISPOSED',
    CONTEXT_LOST = 'CONTEXT_LOST',
    LOAD_FAILED = 'LOAD_FAILED',
    COMPRESSION_FAILED = 'COMPRESSION_FAILED',
    INVALID_OPERATION = 'INVALID_OPERATION',
}
