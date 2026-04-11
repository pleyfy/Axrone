import { Vec2, Vec3, Vec4 } from '@axrone/numeric';
import { ByteBuffer } from '@axrone/utility';
import {
    ITexture,
    ITextureCreateOptions,
    ITextureSubresource,
    TextureDimension,
    TextureFormat,
    TextureUsage,
    ColorSpace,
    TextureDataSource,
    TextureError,
    TextureErrorCode,
} from './interfaces';
import { TextureFormatInfo, TextureUtils, TextureWebGLConstants, TextureValidation } from './utils';

export class WebGLTexture implements ITexture {
    public readonly id: string;
    public readonly nativeHandle: globalThis.WebGLTexture;
    public readonly dimension: TextureDimension;
    public readonly format: TextureFormat;
    public readonly width: number;
    public readonly height: number;
    public readonly depth: number;
    public readonly mipLevels: number;
    public readonly arrayLayers: number;
    public readonly samples: number;
    public readonly usage: TextureUsage;
    public readonly colorSpace: ColorSpace;
    public readonly label: string | null;

    public readonly isCompressed: boolean;
    public readonly bytesPerPixel: number;
    public readonly totalMemoryUsage: number;

    private _isDisposed = false;
    private _currentUnit = -1;
    private _generation = 0;

    private readonly _gl: WebGL2RenderingContext;
    private readonly _target: number;

    constructor(
        gl: WebGL2RenderingContext,
        options: ITextureCreateOptions,
        data?: TextureDataSource
    ) {
        this._gl = gl;

        TextureValidation.validateCreateOptions(options);

        this.id = TextureUtils.generateTextureId();
        this.dimension = options.dimension;
        this.format = options.format;
        this.width = options.width;
        this.height = options.height;
        this.depth = options.depth || 1;
        this.mipLevels = options.mipLevels || 1;
        this.arrayLayers = options.arrayLayers || 1;
        this.samples = options.samples || 1;
        this.usage = options.usage;
        this.colorSpace = options.colorSpace || ColorSpace.LINEAR;
        this.label = options.label || null;

        const formatInfo = TextureFormatInfo.getFormatInfo(this.format);
        this.isCompressed = formatInfo.compressed;
        this.bytesPerPixel = formatInfo.bytesPerPixel;
        this.totalMemoryUsage = TextureUtils.calculateMemoryUsage(
            this.width,
            this.height,
            this.depth,
            this.format,
            this.mipLevels
        );

        this._target = TextureWebGLConstants.getDimensionConstant(this.dimension);

        const handle = this._gl.createTexture();
        if (!handle) {
            throw new TextureError(
                'Failed to create WebGL texture',
                TextureErrorCode.CONTEXT_LOST,
                this.id
            );
        }
        this.nativeHandle = handle as globalThis.WebGLTexture;

        this._initializeStorage();

        if (data !== null && data !== undefined) {
            this.setData(data);
        }

        if (this.label && this._gl.getExtension('WEBGL_debug_renderer_info')) {
            this._gl.bindTexture(this._target, this.nativeHandle);

            this._gl.bindTexture(this._target, null);
        }
    }

    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    public setData(data: TextureDataSource, subresource?: ITextureSubresource): void {
        this._validateNotDisposed();

        const mipLevel = subresource?.mipLevel || 0;
        const arrayLayer = subresource?.arrayLayer || 0;

        const mipDims = TextureUtils.getMipDimensions(
            this.width,
            this.height,
            this.depth,
            mipLevel
        );
        const x = subresource?.x || 0;
        const y = subresource?.y || 0;
        const z = subresource?.z || 0;
        const width = subresource?.width || mipDims.width;
        const height = subresource?.height || mipDims.height;
        const depth = subresource?.depth || mipDims.depth;

        this.bind();

        try {
            this._uploadData(data, mipLevel, arrayLayer, x, y, z, width, height, depth);
            this._generation++;
        } finally {
            this.unbind();
        }
    }

    public async getData(subresource?: ITextureSubresource): Promise<ArrayBufferView> {
        this._validateNotDisposed();

        throw new TextureError(
            'Direct texture data reading not implemented - use framebuffer readback',
            TextureErrorCode.INVALID_OPERATION,
            this.id
        );
    }

    public copyTo(
        destination: ITexture,
        sourceRegion?: ITextureSubresource,
        destRegion?: ITextureSubresource
    ): void {
        this._validateNotDisposed();

        if (destination.isDisposed) {
            throw new TextureError(
                'Cannot copy to disposed texture',
                TextureErrorCode.ALREADY_DISPOSED,
                destination.id
            );
        }

        throw new TextureError(
            'Texture copying not yet implemented',
            TextureErrorCode.INVALID_OPERATION,
            this.id
        );
    }

    public generateMipmaps(): void {
        this._validateNotDisposed();

        if (this.mipLevels <= 1) {
            return;
        }

        if (this.isCompressed) {
            throw new TextureError(
                'Cannot generate mipmaps for compressed textures',
                TextureErrorCode.INVALID_OPERATION,
                this.id
            );
        }

        this.bind();
        this._gl.generateMipmap(this._target);
        this.unbind();

        this._generation++;
    }

    public hasMipmaps(): boolean {
        return this.mipLevels > 1;
    }

    public resize(width: number, height: number, depth?: number): void {
        this._validateNotDisposed();

        const newDepth = depth !== undefined ? depth : this.depth;

        TextureUtils.validateDimensions(width, height, newDepth, this.dimension);

        const newOptions: ITextureCreateOptions = {
            width,
            height,
            depth: newDepth,
            format: this.format,
            dimension: this.dimension,
            mipLevels: this.mipLevels,
            arrayLayers: this.arrayLayers,
            samples: this.samples,
            usage: this.usage,
            colorSpace: this.colorSpace,
            label: this.label || undefined,
        };

        this._initializeStorageWithOptions(newOptions);
        this._generation++;
    }

    public clone(): ITexture {
        this._validateNotDisposed();

        const cloneOptions: ITextureCreateOptions = {
            width: this.width,
            height: this.height,
            depth: this.depth,
            format: this.format,
            dimension: this.dimension,
            mipLevels: this.mipLevels,
            arrayLayers: this.arrayLayers,
            samples: this.samples,
            usage: this.usage,
            colorSpace: this.colorSpace,
            label: this.label ? `${this.label}_clone` : undefined,
        };

        const clone = new WebGLTexture(this._gl, cloneOptions);

        return clone;
    }

    public bind(unit?: number): void {
        this._validateNotDisposed();

        if (unit !== undefined) {
            this._gl.activeTexture(this._gl.TEXTURE0 + unit);
            this._currentUnit = unit;
        }

        this._gl.bindTexture(this._target, this.nativeHandle);
    }

    public unbind(): void {
        if (this._currentUnit >= 0) {
            this._gl.activeTexture(this._gl.TEXTURE0 + this._currentUnit);
        }
        this._gl.bindTexture(this._target, null);
        this._currentUnit = -1;
    }

    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._gl.deleteTexture(this.nativeHandle);
        this._isDisposed = true;
        this._currentUnit = -1;
    }

    private _validateNotDisposed(): void {
        if (this._isDisposed) {
            throw new TextureError(
                'Texture has been disposed',
                TextureErrorCode.ALREADY_DISPOSED,
                this.id
            );
        }
    }

    private _initializeStorage(): void {
        const options: ITextureCreateOptions = {
            width: this.width,
            height: this.height,
            depth: this.depth,
            format: this.format,
            dimension: this.dimension,
            mipLevels: this.mipLevels,
            arrayLayers: this.arrayLayers,
            samples: this.samples,
            usage: this.usage,
            colorSpace: this.colorSpace,
        };

        this._initializeStorageWithOptions(options);
    }

    private _initializeStorageWithOptions(options: ITextureCreateOptions): void {
        this.bind();

        const formatInfo = TextureFormatInfo.getFormatInfo(options.format);

        try {
            switch (options.dimension) {
                case TextureDimension.TEXTURE_2D:
                    this._initializeTexture2D(options, formatInfo);
                    break;

                case TextureDimension.TEXTURE_3D:
                    this._initializeTexture3D(options, formatInfo);
                    break;

                case TextureDimension.TEXTURE_CUBE:
                    this._initializeTextureCube(options, formatInfo);
                    break;

                case TextureDimension.TEXTURE_2D_ARRAY:
                    this._initializeTexture2DArray(options, formatInfo);
                    break;

                default:
                    throw new TextureError(
                        `Unsupported texture dimension: ${options.dimension}`,
                        TextureErrorCode.UNSUPPORTED_FORMAT,
                        this.id
                    );
            }
        } finally {
            this.unbind();
        }
    }

    private _initializeTexture2D(options: ITextureCreateOptions, formatInfo: any): void {
        if (formatInfo.compressed) {
            return;
        }

        for (let mip = 0; mip < options.mipLevels!; mip++) {
            const mipDims = TextureUtils.getMipDimensions(options.width, options.height, 1, mip);

            this._gl.texImage2D(
                this._target,
                mip,
                formatInfo.internalFormat,
                mipDims.width,
                mipDims.height,
                0,
                formatInfo.format,
                formatInfo.type,
                null
            );
        }
    }

    private _initializeTexture3D(options: ITextureCreateOptions, formatInfo: any): void {
        if (formatInfo.compressed) {
            return;
        }

        for (let mip = 0; mip < options.mipLevels!; mip++) {
            const mipDims = TextureUtils.getMipDimensions(
                options.width,
                options.height,
                options.depth!,
                mip
            );

            this._gl.texImage3D(
                this._target,
                mip,
                formatInfo.internalFormat,
                mipDims.width,
                mipDims.height,
                mipDims.depth,
                0,
                formatInfo.format,
                formatInfo.type,
                null
            );
        }
    }

    private _initializeTextureCube(options: ITextureCreateOptions, formatInfo: any): void {
        if (formatInfo.compressed) {
            return;
        }

        const faces = [
            this._gl.TEXTURE_CUBE_MAP_POSITIVE_X,
            this._gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
            this._gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
            this._gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
            this._gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
            this._gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
        ];

        for (let face = 0; face < 6; face++) {
            for (let mip = 0; mip < options.mipLevels!; mip++) {
                const mipDims = TextureUtils.getMipDimensions(
                    options.width,
                    options.height,
                    1,
                    mip
                );

                this._gl.texImage2D(
                    faces[face],
                    mip,
                    formatInfo.internalFormat,
                    mipDims.width,
                    mipDims.height,
                    0,
                    formatInfo.format,
                    formatInfo.type,
                    null
                );
            }
        }
    }

    private _initializeTexture2DArray(options: ITextureCreateOptions, formatInfo: any): void {
        if (formatInfo.compressed) {
            return;
        }

        for (let mip = 0; mip < options.mipLevels!; mip++) {
            const mipDims = TextureUtils.getMipDimensions(options.width, options.height, 1, mip);

            this._gl.texImage3D(
                this._target,
                mip,
                formatInfo.internalFormat,
                mipDims.width,
                mipDims.height,
                options.arrayLayers!,
                0,
                formatInfo.format,
                formatInfo.type,
                null
            );
        }
    }

    private _uploadData(
        data: TextureDataSource,
        mipLevel: number,
        arrayLayer: number,
        x: number,
        y: number,
        z: number,
        width: number,
        height: number,
        depth: number
    ): void {
        const formatInfo = TextureFormatInfo.getFormatInfo(this.format);

        if (data === null) {
            return;
        }

        if (data instanceof ByteBuffer) {
            this._uploadBufferData(
                data,
                formatInfo,
                mipLevel,
                arrayLayer,
                x,
                y,
                z,
                width,
                height,
                depth
            );
        } else if (
            data instanceof HTMLImageElement ||
            data instanceof HTMLCanvasElement ||
            data instanceof HTMLVideoElement ||
            data instanceof ImageBitmap
        ) {
            this._uploadImageData(data, formatInfo, mipLevel, arrayLayer, x, y);
        } else if (data instanceof ImageData) {
            this._uploadImageData(data, formatInfo, mipLevel, arrayLayer, x, y);
        } else if (ArrayBuffer.isView(data)) {
            this._uploadTypedArrayData(
                data,
                formatInfo,
                mipLevel,
                arrayLayer,
                x,
                y,
                z,
                width,
                height,
                depth
            );
        } else {
            throw new TextureError(
                'Unsupported data source type',
                TextureErrorCode.INVALID_DATA,
                this.id
            );
        }
    }

    private _uploadBufferData(
        buffer: ByteBuffer,
        formatInfo: any,
        mipLevel: number,
        arrayLayer: number,
        x: number,
        y: number,
        z: number,
        width: number,
        height: number,
        depth: number
    ): void {
        const typedView = buffer.asTypedView('uint8');
        const values = typedView.getValues(0, typedView.capacity);
        const data = new Uint8Array(values);
        this._uploadTypedArrayData(
            data,
            formatInfo,
            mipLevel,
            arrayLayer,
            x,
            y,
            z,
            width,
            height,
            depth
        );
    }

    private _uploadImageData(
        image: TexImageSource,
        formatInfo: any,
        mipLevel: number,
        arrayLayer: number,
        x: number,
        y: number
    ): void {
        if (this.isCompressed) {
            throw new TextureError(
                'Image upload is not supported for compressed textures',
                TextureErrorCode.INVALID_OPERATION,
                this.id
            );
        }

        switch (this.dimension) {
            case TextureDimension.TEXTURE_2D:
                this._gl.texSubImage2D(
                    this._target,
                    mipLevel,
                    x,
                    y,
                    formatInfo.format,
                    formatInfo.type,
                    image
                );
                break;

            case TextureDimension.TEXTURE_CUBE:
                const faces = [
                    this._gl.TEXTURE_CUBE_MAP_POSITIVE_X,
                    this._gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                    this._gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
                    this._gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
                    this._gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
                    this._gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
                ];

                this._gl.texSubImage2D(
                    faces[arrayLayer],
                    mipLevel,
                    x,
                    y,
                    formatInfo.format,
                    formatInfo.type,
                    image
                );
                break;

            default:
                throw new TextureError(
                    `Image upload not supported for dimension: ${this.dimension}`,
                    TextureErrorCode.INVALID_OPERATION,
                    this.id
                );
        }
    }

    private _uploadTypedArrayData(
        data: ArrayBufferView,
        formatInfo: any,
        mipLevel: number,
        arrayLayer: number,
        x: number,
        y: number,
        z: number,
        width: number,
        height: number,
        depth: number
    ): void {
        if (this.isCompressed) {
            this._uploadCompressedTypedArrayData(
                data,
                mipLevel,
                arrayLayer,
                x,
                y,
                z,
                width,
                height,
                depth
            );
            return;
        }

        switch (this.dimension) {
            case TextureDimension.TEXTURE_2D:
                this._gl.texSubImage2D(
                    this._target,
                    mipLevel,
                    x,
                    y,
                    width,
                    height,
                    formatInfo.format,
                    formatInfo.type,
                    data
                );
                break;

            case TextureDimension.TEXTURE_3D:
                this._gl.texSubImage3D(
                    this._target,
                    mipLevel,
                    x,
                    y,
                    z,
                    width,
                    height,
                    depth,
                    formatInfo.format,
                    formatInfo.type,
                    data
                );
                break;

            case TextureDimension.TEXTURE_2D_ARRAY:
                this._gl.texSubImage3D(
                    this._target,
                    mipLevel,
                    x,
                    y,
                    arrayLayer,
                    width,
                    height,
                    1,
                    formatInfo.format,
                    formatInfo.type,
                    data
                );
                break;

            case TextureDimension.TEXTURE_CUBE:
                const faces = [
                    this._gl.TEXTURE_CUBE_MAP_POSITIVE_X,
                    this._gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                    this._gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
                    this._gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
                    this._gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
                    this._gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
                ];

                this._gl.texSubImage2D(
                    faces[arrayLayer],
                    mipLevel,
                    x,
                    y,
                    width,
                    height,
                    formatInfo.format,
                    formatInfo.type,
                    data
                );
                break;

            default:
                throw new TextureError(
                    `Data upload not supported for dimension: ${this.dimension}`,
                    TextureErrorCode.INVALID_OPERATION,
                    this.id
                );
        }
    }

    private _uploadCompressedTypedArrayData(
        data: ArrayBufferView,
        mipLevel: number,
        arrayLayer: number,
        x: number,
        y: number,
        z: number,
        width: number,
        height: number,
        depth: number
    ): void {
        if (x !== 0 || y !== 0 || z !== 0) {
            throw new TextureError(
                'Compressed texture uploads must cover the full mip level',
                TextureErrorCode.INVALID_OPERATION,
                this.id
            );
        }

        if (depth !== 1) {
            throw new TextureError(
                'Compressed texture uploads only support 2D surfaces',
                TextureErrorCode.INVALID_OPERATION,
                this.id
            );
        }

        const internalFormat = TextureWebGLConstants.getCompressedInternalFormat(
            this._gl,
            this.format
        );

        switch (this.dimension) {
            case TextureDimension.TEXTURE_2D:
                this._gl.compressedTexImage2D(
                    this._target,
                    mipLevel,
                    internalFormat,
                    width,
                    height,
                    0,
                    data
                );
                break;

            case TextureDimension.TEXTURE_CUBE:
                const faces = [
                    this._gl.TEXTURE_CUBE_MAP_POSITIVE_X,
                    this._gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                    this._gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
                    this._gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
                    this._gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
                    this._gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
                ];

                this._gl.compressedTexImage2D(
                    faces[arrayLayer],
                    mipLevel,
                    internalFormat,
                    width,
                    height,
                    0,
                    data
                );
                break;

            default:
                throw new TextureError(
                    `Compressed texture uploads are not supported for dimension: ${this.dimension}`,
                    TextureErrorCode.INVALID_OPERATION,
                    this.id
                );
        }
    }
}
