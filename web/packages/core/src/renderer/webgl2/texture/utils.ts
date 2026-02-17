import { Vec2, Vec3, Vec4 } from '@axrone/numeric';
import { 
    TextureDimension, 
    TextureFormat, 
    FilterMode, 
    WrapMode, 
    TextureUsage,
    ColorSpace,
    ITextureCreateOptions,
    ITextureSamplerOptions,
    TextureError,
    TextureErrorCode
} from './interfaces';

interface FormatInfo {
    readonly internalFormat: number;
    readonly format: number;
    readonly type: number;
    readonly bytesPerPixel: number;
    readonly channels: number;
    readonly compressed: boolean;
    readonly blockSize?: number;
    readonly floatingPoint: boolean;
    readonly integer: boolean;
    readonly depth: boolean;
    readonly stencil: boolean;
    readonly srgb: boolean;
}

export class TextureFormatInfo {
    private static readonly formatDatabase = new Map<TextureFormat, FormatInfo>([

        [TextureFormat.R8, { 
            internalFormat: WebGL2RenderingContext.R8, 
            format: WebGL2RenderingContext.RED, 
            type: WebGL2RenderingContext.UNSIGNED_BYTE, 
            bytesPerPixel: 1, channels: 1, compressed: false, floatingPoint: false, integer: false, depth: false, stencil: false, srgb: false 
        }],
        [TextureFormat.RG8, { 
            internalFormat: WebGL2RenderingContext.RG8, 
            format: WebGL2RenderingContext.RG, 
            type: WebGL2RenderingContext.UNSIGNED_BYTE, 
            bytesPerPixel: 2, channels: 2, compressed: false, floatingPoint: false, integer: false, depth: false, stencil: false, srgb: false 
        }],
        [TextureFormat.RGB8, { 
            internalFormat: WebGL2RenderingContext.RGB8, 
            format: WebGL2RenderingContext.RGB, 
            type: WebGL2RenderingContext.UNSIGNED_BYTE, 
            bytesPerPixel: 3, channels: 3, compressed: false, floatingPoint: false, integer: false, depth: false, stencil: false, srgb: false 
        }],
        [TextureFormat.RGBA8, { 
            internalFormat: WebGL2RenderingContext.RGBA8, 
            format: WebGL2RenderingContext.RGBA, 
            type: WebGL2RenderingContext.UNSIGNED_BYTE, 
            bytesPerPixel: 4, channels: 4, compressed: false, floatingPoint: false, integer: false, depth: false, stencil: false, srgb: false 
        }],

        [TextureFormat.R16F, { 
            internalFormat: WebGL2RenderingContext.R16F, 
            format: WebGL2RenderingContext.RED, 
            type: WebGL2RenderingContext.HALF_FLOAT, 
            bytesPerPixel: 2, channels: 1, compressed: false, floatingPoint: true, integer: false, depth: false, stencil: false, srgb: false 
        }],
        [TextureFormat.RG16F, { 
            internalFormat: WebGL2RenderingContext.RG16F, 
            format: WebGL2RenderingContext.RG, 
            type: WebGL2RenderingContext.HALF_FLOAT, 
            bytesPerPixel: 4, channels: 2, compressed: false, floatingPoint: true, integer: false, depth: false, stencil: false, srgb: false 
        }],
        [TextureFormat.RGB16F, { 
            internalFormat: WebGL2RenderingContext.RGB16F, 
            format: WebGL2RenderingContext.RGB, 
            type: WebGL2RenderingContext.HALF_FLOAT, 
            bytesPerPixel: 6, channels: 3, compressed: false, floatingPoint: true, integer: false, depth: false, stencil: false, srgb: false 
        }],
        [TextureFormat.RGBA16F, { 
            internalFormat: WebGL2RenderingContext.RGBA16F, 
            format: WebGL2RenderingContext.RGBA, 
            type: WebGL2RenderingContext.HALF_FLOAT, 
            bytesPerPixel: 8, channels: 4, compressed: false, floatingPoint: true, integer: false, depth: false, stencil: false, srgb: false 
        }],

        [TextureFormat.R32F, { 
            internalFormat: WebGL2RenderingContext.R32F, 
            format: WebGL2RenderingContext.RED, 
            type: WebGL2RenderingContext.FLOAT, 
            bytesPerPixel: 4, channels: 1, compressed: false, floatingPoint: true, integer: false, depth: false, stencil: false, srgb: false 
        }],
        [TextureFormat.RG32F, { 
            internalFormat: WebGL2RenderingContext.RG32F, 
            format: WebGL2RenderingContext.RG, 
            type: WebGL2RenderingContext.FLOAT, 
            bytesPerPixel: 8, channels: 2, compressed: false, floatingPoint: true, integer: false, depth: false, stencil: false, srgb: false 
        }],
        [TextureFormat.RGB32F, { 
            internalFormat: WebGL2RenderingContext.RGB32F, 
            format: WebGL2RenderingContext.RGB, 
            type: WebGL2RenderingContext.FLOAT, 
            bytesPerPixel: 12, channels: 3, compressed: false, floatingPoint: true, integer: false, depth: false, stencil: false, srgb: false 
        }],
        [TextureFormat.RGBA32F, { 
            internalFormat: WebGL2RenderingContext.RGBA32F, 
            format: WebGL2RenderingContext.RGBA, 
            type: WebGL2RenderingContext.FLOAT, 
            bytesPerPixel: 16, channels: 4, compressed: false, floatingPoint: true, integer: false, depth: false, stencil: false, srgb: false 
        }],

        [TextureFormat.DEPTH_COMPONENT16, { 
            internalFormat: WebGL2RenderingContext.DEPTH_COMPONENT16, 
            format: WebGL2RenderingContext.DEPTH_COMPONENT, 
            type: WebGL2RenderingContext.UNSIGNED_SHORT, 
            bytesPerPixel: 2, channels: 1, compressed: false, floatingPoint: false, integer: false, depth: true, stencil: false, srgb: false 
        }],
        [TextureFormat.DEPTH_COMPONENT24, { 
            internalFormat: WebGL2RenderingContext.DEPTH_COMPONENT24, 
            format: WebGL2RenderingContext.DEPTH_COMPONENT, 
            type: WebGL2RenderingContext.UNSIGNED_INT, 
            bytesPerPixel: 4, channels: 1, compressed: false, floatingPoint: false, integer: false, depth: true, stencil: false, srgb: false 
        }],
        [TextureFormat.DEPTH_COMPONENT32F, { 
            internalFormat: WebGL2RenderingContext.DEPTH_COMPONENT32F, 
            format: WebGL2RenderingContext.DEPTH_COMPONENT, 
            type: WebGL2RenderingContext.FLOAT, 
            bytesPerPixel: 4, channels: 1, compressed: false, floatingPoint: true, integer: false, depth: true, stencil: false, srgb: false 
        }],
        [TextureFormat.DEPTH24_STENCIL8, { 
            internalFormat: WebGL2RenderingContext.DEPTH24_STENCIL8, 
            format: WebGL2RenderingContext.DEPTH_STENCIL, 
            type: WebGL2RenderingContext.UNSIGNED_INT_24_8, 
            bytesPerPixel: 4, channels: 2, compressed: false, floatingPoint: false, integer: false, depth: true, stencil: true, srgb: false 
        }],
        [TextureFormat.DEPTH32F_STENCIL8, { 
            internalFormat: WebGL2RenderingContext.DEPTH32F_STENCIL8, 
            format: WebGL2RenderingContext.DEPTH_STENCIL, 
            type: WebGL2RenderingContext.FLOAT_32_UNSIGNED_INT_24_8_REV, 
            bytesPerPixel: 8, channels: 2, compressed: false, floatingPoint: true, integer: false, depth: true, stencil: true, srgb: false 
        }]
    ]);

    public static getFormatInfo(format: TextureFormat): FormatInfo {
        const info = this.formatDatabase.get(format);
        if (!info) {
            throw new TextureError(
                `Unsupported texture format: ${format}`,
                TextureErrorCode.UNSUPPORTED_FORMAT
            );
        }
        return info;
    }

    public static getBytesPerPixel(format: TextureFormat): number {
        return this.getFormatInfo(format).bytesPerPixel;
    }

    public static getChannelCount(format: TextureFormat): number {
        return this.getFormatInfo(format).channels;
    }

    public static isCompressed(format: TextureFormat): boolean {
        return this.getFormatInfo(format).compressed;
    }

    public static isFloatingPoint(format: TextureFormat): boolean {
        return this.getFormatInfo(format).floatingPoint;
    }

    public static isInteger(format: TextureFormat): boolean {
        return this.getFormatInfo(format).integer;
    }

    public static isDepth(format: TextureFormat): boolean {
        return this.getFormatInfo(format).depth;
    }

    public static hasStencil(format: TextureFormat): boolean {
        return this.getFormatInfo(format).stencil;
    }

    public static isSRGB(format: TextureFormat): boolean {
        return this.getFormatInfo(format).srgb;
    }

    public static getSupportedFormats(): readonly TextureFormat[] {
        return Array.from(this.formatDatabase.keys());
    }
}

export class TextureWebGLConstants {
    public static readonly DIMENSION_MAP = new Map<TextureDimension, number>([
        [TextureDimension.TEXTURE_1D, 0x0DE0], 
        [TextureDimension.TEXTURE_2D, WebGL2RenderingContext.TEXTURE_2D],
        [TextureDimension.TEXTURE_3D, WebGL2RenderingContext.TEXTURE_3D],
        [TextureDimension.TEXTURE_CUBE, WebGL2RenderingContext.TEXTURE_CUBE_MAP],
        [TextureDimension.TEXTURE_2D_ARRAY, WebGL2RenderingContext.TEXTURE_2D_ARRAY],
        [TextureDimension.TEXTURE_CUBE_ARRAY, 0x9009] 
    ]);

    public static readonly FILTER_MAP = new Map<FilterMode, number>([
        [FilterMode.NEAREST, WebGL2RenderingContext.NEAREST],
        [FilterMode.LINEAR, WebGL2RenderingContext.LINEAR],
        [FilterMode.NEAREST_MIPMAP_NEAREST, WebGL2RenderingContext.NEAREST_MIPMAP_NEAREST],
        [FilterMode.LINEAR_MIPMAP_NEAREST, WebGL2RenderingContext.LINEAR_MIPMAP_NEAREST],
        [FilterMode.NEAREST_MIPMAP_LINEAR, WebGL2RenderingContext.NEAREST_MIPMAP_LINEAR],
        [FilterMode.LINEAR_MIPMAP_LINEAR, WebGL2RenderingContext.LINEAR_MIPMAP_LINEAR]
    ]);

    public static readonly WRAP_MAP = new Map<WrapMode, number>([
        [WrapMode.REPEAT, WebGL2RenderingContext.REPEAT],
        [WrapMode.CLAMP_TO_EDGE, WebGL2RenderingContext.CLAMP_TO_EDGE],
        [WrapMode.CLAMP_TO_BORDER, 0x812D], 
        [WrapMode.MIRRORED_REPEAT, WebGL2RenderingContext.MIRRORED_REPEAT]
    ]);

    public static getDimensionConstant(dimension: TextureDimension): number {
        const constant = this.DIMENSION_MAP.get(dimension);
        if (constant === undefined) {
            throw new TextureError(
                `Unsupported texture dimension: ${dimension}`,
                TextureErrorCode.UNSUPPORTED_FORMAT
            );
        }
        return constant;
    }

    public static getFilterConstant(filter: FilterMode): number {
        const constant = this.FILTER_MAP.get(filter);
        if (constant === undefined) {
            throw new TextureError(
                `Unsupported filter mode: ${filter}`,
                TextureErrorCode.INVALID_OPERATION
            );
        }
        return constant;
    }

    public static getWrapConstant(wrap: WrapMode): number {
        const constant = this.WRAP_MAP.get(wrap);
        if (constant === undefined) {
            throw new TextureError(
                `Unsupported wrap mode: ${wrap}`,
                TextureErrorCode.INVALID_OPERATION
            );
        }
        return constant;
    }
}

export class TextureUtils {

    public static calculateMemoryUsage(
        width: number, 
        height: number, 
        depth: number, 
        format: TextureFormat, 
        mipLevels: number = 1
    ): number {
        const bytesPerPixel = TextureFormatInfo.getBytesPerPixel(format);
        let totalBytes = 0;

        for (let mip = 0; mip < mipLevels; mip++) {
            const mipWidth = Math.max(1, width >> mip);
            const mipHeight = Math.max(1, height >> mip);
            const mipDepth = Math.max(1, depth >> mip);

            totalBytes += mipWidth * mipHeight * mipDepth * bytesPerPixel;
        }

        return totalBytes;
    }

    public static calculateMaxMipLevels(width: number, height: number, depth: number = 1): number {
        const maxDimension = Math.max(width, height, depth);
        return Math.floor(Math.log2(maxDimension)) + 1;
    }

    public static getMipDimensions(
        width: number, 
        height: number, 
        depth: number, 
        mipLevel: number
    ): { width: number; height: number; depth: number } {
        return {
            width: Math.max(1, width >> mipLevel),
            height: Math.max(1, height >> mipLevel),
            depth: Math.max(1, depth >> mipLevel)
        };
    }

    public static validateDimensions(
        width: number, 
        height: number, 
        depth: number, 
        dimension: TextureDimension
    ): void {
        if (width <= 0 || height <= 0 || depth <= 0) {
            throw new TextureError(
                'Texture dimensions must be positive',
                TextureErrorCode.INVALID_DIMENSIONS
            );
        }

        const isPowerOfTwo = (n: number) => (n & (n - 1)) === 0;

        switch (dimension) {
            case TextureDimension.TEXTURE_CUBE:
                if (width !== height) {
                    throw new TextureError(
                        'Cube textures must have equal width and height',
                        TextureErrorCode.INVALID_DIMENSIONS
                    );
                }
                break;

            case TextureDimension.TEXTURE_1D:
                if (height !== 1 || depth !== 1) {
                    throw new TextureError(
                        '1D textures must have height and depth of 1',
                        TextureErrorCode.INVALID_DIMENSIONS
                    );
                }
                break;

            case TextureDimension.TEXTURE_2D:
            case TextureDimension.TEXTURE_2D_ARRAY:
                if (depth < 1 && dimension === TextureDimension.TEXTURE_2D) {
                    throw new TextureError(
                        '2D textures must have depth of at least 1',
                        TextureErrorCode.INVALID_DIMENSIONS
                    );
                }
                break;
        }
    }

    public static isFormatCompatible(format: TextureFormat, dimension: TextureDimension): boolean {

        if (dimension === TextureDimension.TEXTURE_3D && TextureFormatInfo.isDepth(format)) {
            return false;
        }

        if (TextureFormatInfo.isInteger(format)) {

        }

        return true;
    }

    public static generateTextureId(): string {
        return `tex_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    public static calculateTextureHash(options: ITextureCreateOptions): string {
        const hashData = [
            options.width,
            options.height,
            options.depth || 1,
            options.format,
            options.dimension,
            options.mipLevels || 1,
            options.arrayLayers || 1,
            options.usage,
            options.colorSpace || ColorSpace.LINEAR
        ].join('|');

        return this.simpleHash(hashData);
    }

    private static simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; 
        }
        return Math.abs(hash).toString(36);
    }

    public static getDefaultSamplerOptions(usage: TextureUsage): ITextureSamplerOptions {
        switch (usage) {
            case TextureUsage.STATIC:
                return {
                    minFilter: FilterMode.LINEAR_MIPMAP_LINEAR,
                    magFilter: FilterMode.LINEAR,
                    wrapS: WrapMode.REPEAT,
                    wrapT: WrapMode.REPEAT,
                    maxAnisotropy: 16
                };

            case TextureUsage.RENDER_TARGET:
                return {
                    minFilter: FilterMode.LINEAR,
                    magFilter: FilterMode.LINEAR,
                    wrapS: WrapMode.CLAMP_TO_EDGE,
                    wrapT: WrapMode.CLAMP_TO_EDGE
                };

            case TextureUsage.DEPTH_BUFFER:
                return {
                    minFilter: FilterMode.NEAREST,
                    magFilter: FilterMode.NEAREST,
                    wrapS: WrapMode.CLAMP_TO_EDGE,
                    wrapT: WrapMode.CLAMP_TO_EDGE,
                    compareMode: 'COMPARE_REF_TO_TEXTURE',
                    compareFunc: 'LEQUAL'
                };

            default:
                return {
                    minFilter: FilterMode.LINEAR,
                    magFilter: FilterMode.LINEAR,
                    wrapS: WrapMode.REPEAT,
                    wrapT: WrapMode.REPEAT
                };
        }
    }

    public static colorToVec4(color: string): Vec4 {

        if (color.startsWith('#')) {
            const hex = color.slice(1);
            const r = parseInt(hex.substr(0, 2), 16) / 255;
            const g = parseInt(hex.substr(2, 2), 16) / 255;
            const b = parseInt(hex.substr(4, 2), 16) / 255;
            const a = hex.length === 8 ? parseInt(hex.substr(6, 2), 16) / 255 : 1;
            return new Vec4(r, g, b, a);
        }

        return new Vec4(1, 1, 1, 1);
    }

    public static isExtensionAvailable(gl: WebGL2RenderingContext, name: string): boolean {
        return gl.getExtension(name) !== null;
    }

    public static getOptimalFormat(
        gl: WebGL2RenderingContext,
        usage: TextureUsage,
        hasAlpha: boolean = false,
        preferFloat: boolean = false
    ): TextureFormat {
        if (usage === TextureUsage.DEPTH_BUFFER) {
            return TextureFormat.DEPTH_COMPONENT24;
        }

        if (preferFloat) {
            return hasAlpha ? TextureFormat.RGBA16F : TextureFormat.RGB16F;
        }

        return hasAlpha ? TextureFormat.RGBA8 : TextureFormat.RGB8;
    }
}

export class TextureValidation {

    public static validateCreateOptions(options: ITextureCreateOptions): void {

        TextureUtils.validateDimensions(
            options.width, 
            options.height, 
            options.depth || 1, 
            options.dimension
        );

        if (!TextureUtils.isFormatCompatible(options.format, options.dimension)) {
            throw new TextureError(
                `Format ${options.format} is not compatible with dimension ${options.dimension}`,
                TextureErrorCode.UNSUPPORTED_FORMAT
            );
        }

        if (options.mipLevels !== undefined) {
            const maxMips = TextureUtils.calculateMaxMipLevels(
                options.width, 
                options.height, 
                options.depth || 1
            );
            if (options.mipLevels > maxMips) {
                throw new TextureError(
                    `Too many mip levels: ${options.mipLevels}, maximum is ${maxMips}`,
                    TextureErrorCode.INVALID_DIMENSIONS
                );
            }
        }

        if (options.arrayLayers !== undefined && options.arrayLayers < 1) {
            throw new TextureError(
                'Array layers must be at least 1',
                TextureErrorCode.INVALID_DIMENSIONS
            );
        }

        if (options.samples !== undefined) {
            const validSamples = [1, 2, 4, 8, 16];
            if (!validSamples.includes(options.samples)) {
                throw new TextureError(
                    `Invalid sample count: ${options.samples}`,
                    TextureErrorCode.INVALID_DIMENSIONS
                );
            }
        }
    }

    public static validateSamplerOptions(options: ITextureSamplerOptions): void {

        if (options.maxAnisotropy !== undefined && options.maxAnisotropy < 1) {
            throw new TextureError(
                'Max anisotropy must be at least 1',
                TextureErrorCode.INVALID_OPERATION
            );
        }

        if (options.minLod !== undefined && options.maxLod !== undefined) {
            if (options.minLod > options.maxLod) {
                throw new TextureError(
                    'Min LOD cannot be greater than max LOD',
                    TextureErrorCode.INVALID_OPERATION
                );
            }
        }

        if (options.borderColor) {
            const color = options.borderColor;
            if (color.x < 0 || color.x > 1 || color.y < 0 || color.y > 1 ||
                color.z < 0 || color.z > 1 || color.w < 0 || color.w > 1) {
                throw new TextureError(
                    'Border color components must be in range [0, 1]',
                    TextureErrorCode.INVALID_OPERATION
                );
            }
        }
    }
}
