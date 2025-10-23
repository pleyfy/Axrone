import { IDisposable } from '../../types';
import { ITexture, IBindableTarget } from './texture/interfaces';

type Nominal<T, K extends string> = T & { readonly __brand: K };

export type FramebufferId = Nominal<WebGLFramebuffer, 'FramebufferId'>;
export type RenderbufferId = Nominal<WebGLRenderbuffer, 'RenderbufferId'>;

export type GLTextureTarget =
    | WebGL2RenderingContext['TEXTURE_2D']
    | WebGL2RenderingContext['TEXTURE_CUBE_MAP']
    | WebGL2RenderingContext['TEXTURE_2D_ARRAY']
    | WebGL2RenderingContext['TEXTURE_3D'];

export type GLTextureFormat =
    | WebGL2RenderingContext['RGB']
    | WebGL2RenderingContext['RGBA']
    | WebGL2RenderingContext['RGBA8']
    | WebGL2RenderingContext['RGBA16F']
    | WebGL2RenderingContext['RGBA32F']
    | WebGL2RenderingContext['RGB8']
    | WebGL2RenderingContext['RGB16F']
    | WebGL2RenderingContext['RGB32F']
    | WebGL2RenderingContext['R8']
    | WebGL2RenderingContext['R16F']
    | WebGL2RenderingContext['R32F']
    | WebGL2RenderingContext['RG8']
    | WebGL2RenderingContext['RG16F']
    | WebGL2RenderingContext['RG32F']
    | WebGL2RenderingContext['DEPTH_COMPONENT16']
    | WebGL2RenderingContext['DEPTH_COMPONENT24']
    | WebGL2RenderingContext['DEPTH_COMPONENT32F']
    | WebGL2RenderingContext['DEPTH24_STENCIL8']
    | WebGL2RenderingContext['DEPTH32F_STENCIL8'];

export type GLAttachment =
    | WebGL2RenderingContext['COLOR_ATTACHMENT0']
    | WebGL2RenderingContext['COLOR_ATTACHMENT1']
    | WebGL2RenderingContext['COLOR_ATTACHMENT2']
    | WebGL2RenderingContext['COLOR_ATTACHMENT3']
    | WebGL2RenderingContext['COLOR_ATTACHMENT4']
    | WebGL2RenderingContext['COLOR_ATTACHMENT5']
    | WebGL2RenderingContext['COLOR_ATTACHMENT6']
    | WebGL2RenderingContext['COLOR_ATTACHMENT7']
    | WebGL2RenderingContext['COLOR_ATTACHMENT8']
    | WebGL2RenderingContext['COLOR_ATTACHMENT9']
    | WebGL2RenderingContext['COLOR_ATTACHMENT10']
    | WebGL2RenderingContext['COLOR_ATTACHMENT11']
    | WebGL2RenderingContext['COLOR_ATTACHMENT12']
    | WebGL2RenderingContext['COLOR_ATTACHMENT13']
    | WebGL2RenderingContext['COLOR_ATTACHMENT14']
    | WebGL2RenderingContext['COLOR_ATTACHMENT15']
    | WebGL2RenderingContext['DEPTH_ATTACHMENT']
    | WebGL2RenderingContext['STENCIL_ATTACHMENT']
    | WebGL2RenderingContext['DEPTH_STENCIL_ATTACHMENT'];

export type GLFilterMode = WebGL2RenderingContext['NEAREST'] | WebGL2RenderingContext['LINEAR'];

export type GLWrapMode =
    | WebGL2RenderingContext['CLAMP_TO_EDGE']
    | WebGL2RenderingContext['REPEAT']
    | WebGL2RenderingContext['MIRRORED_REPEAT'];

export type FramebufferStatus =
    | WebGL2RenderingContext['FRAMEBUFFER_COMPLETE']
    | WebGL2RenderingContext['FRAMEBUFFER_INCOMPLETE_ATTACHMENT']
    | WebGL2RenderingContext['FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT']
    | WebGL2RenderingContext['FRAMEBUFFER_INCOMPLETE_DIMENSIONS']
    | WebGL2RenderingContext['FRAMEBUFFER_UNSUPPORTED']
    | WebGL2RenderingContext['FRAMEBUFFER_INCOMPLETE_MULTISAMPLE'];

export type ErrorCode =
    | 'INVALID_OPERATION'
    | 'FRAMEBUFFER_ALREADY_DISPOSED'
    | 'TEXTURE_ALREADY_DISPOSED'
    | 'RENDERBUFFER_ALREADY_DISPOSED'
    | 'OUT_OF_MEMORY'
    | 'INVALID_VALUE'
    | 'CONTEXT_LOST'
    | 'UNSUPPORTED_OPERATION'
    | 'INCOMPLETE_FRAMEBUFFER'
    | 'INVALID_ATTACHMENT'
    | 'ATTACHMENT_MISMATCH'
    | 'MAX_COLOR_ATTACHMENTS_EXCEEDED';

export class FramebufferError extends Error {
    constructor(
        public readonly message: string,
        public readonly code: ErrorCode,
        public readonly cause?: Error
    ) {
        super(`[WebGL2 Framebuffer] ${code}: ${message}`);
        Object.setPrototypeOf(this, new.target.prototype);
        Error.captureStackTrace?.(this, this.constructor);
    }
}

export interface TextureOptions {
    readonly width: number;
    readonly height: number;
    readonly format?: GLTextureFormat;
    readonly internalFormat?: GLTextureFormat;
    readonly type?: GLenum;
    readonly minFilter?: GLFilterMode;
    readonly magFilter?: GLFilterMode;
    readonly wrapS?: GLWrapMode;
    readonly wrapT?: GLWrapMode;
    readonly generateMipmap?: boolean;
    readonly samples?: number;
    readonly label?: string;
}

export interface RenderbufferOptions {
    readonly width: number;
    readonly height: number;
    readonly internalFormat: GLTextureFormat;
    readonly samples?: number;
    readonly label?: string;
}

export interface AttachmentConfig {
    readonly attachment: GLAttachment;
    readonly texture?: ITexture;
    readonly renderbuffer?: IRenderbuffer;
    readonly level?: number;
    readonly layer?: number;
}

export interface FramebufferOptions {
    readonly width: number;
    readonly height: number;
    readonly colorAttachments?: readonly AttachmentConfig[];
    readonly depthAttachment?: AttachmentConfig;
    readonly stencilAttachment?: AttachmentConfig;
    readonly depthStencilAttachment?: AttachmentConfig;
    readonly label?: string;
}

export interface IBindableTarget<T> {
    readonly bind: () => T;
    readonly unbind: () => T;
}

export interface ITexture extends IDisposable, IBindableTarget<ITexture> {
    readonly id: TextureId;
    readonly target: GLTextureTarget;
    readonly width: number;
    readonly height: number;
    readonly format: GLTextureFormat;
    readonly internalFormat: GLTextureFormat;
    readonly type: GLenum;
    readonly samples: number;
    readonly label: string | null;

    readonly resize: (width: number, height: number) => ITexture;
    readonly generateMipmap: () => ITexture;
    readonly setData: (data: TexImageSource | ArrayBufferView | null, level?: number) => ITexture;
    readonly getPixels: <T extends ArrayBufferView>(output: T, level?: number) => T;
}

export interface IRenderbuffer extends IDisposable, IBindableTarget<IRenderbuffer> {
    readonly id: RenderbufferId;
    readonly width: number;
    readonly height: number;
    readonly internalFormat: GLTextureFormat;
    readonly samples: number;
    readonly label: string | null;

    readonly resize: (width: number, height: number, samples?: number) => IRenderbuffer;
}

export interface IFramebuffer extends IDisposable, IBindableTarget<IFramebuffer> {
    readonly id: FramebufferId;
    readonly width: number;
    readonly height: number;
    readonly label: string | null;
    readonly isComplete: boolean;
    readonly status: FramebufferStatus;
    readonly colorAttachments: readonly ITexture[];
    readonly depthAttachment: ITexture | IRenderbuffer | null;
    readonly stencilAttachment: ITexture | IRenderbuffer | null;
    readonly depthStencilAttachment: ITexture | IRenderbuffer | null;

    readonly attachTexture: (
        attachment: GLAttachment,
        texture: ITexture,
        level?: number,
        layer?: number
    ) => IFramebuffer;

    readonly attachRenderbuffer: (
        attachment: GLAttachment,
        renderbuffer: IRenderbuffer
    ) => IFramebuffer;

    readonly detach: (attachment: GLAttachment) => IFramebuffer;
    readonly resize: (width: number, height: number) => IFramebuffer;
    readonly clear: (
        color?: [number, number, number, number],
        depth?: number,
        stencil?: number
    ) => IFramebuffer;
    readonly readPixels: <T extends ArrayBufferView>(
        output: T,
        x?: number,
        y?: number,
        width?: number,
        height?: number,
        attachment?: GLAttachment
    ) => T;

    readonly blit: (
        source: IFramebuffer,
        srcRect?: [number, number, number, number],
        dstRect?: [number, number, number, number],
        mask?: GLbitfield,
        filter?: GLFilterMode
    ) => IFramebuffer;
}

export interface IFramebufferFactory {
    readonly createTexture: (target: GLTextureTarget, options: TextureOptions) => ITexture;
    readonly createTexture2D: (options: TextureOptions) => ITexture;
    readonly createTextureCube: (options: TextureOptions) => ITexture;
    readonly createTexture2DArray: (options: TextureOptions & { depth: number }) => ITexture;
    readonly createTexture3D: (options: TextureOptions & { depth: number }) => ITexture;

    readonly createRenderbuffer: (options: RenderbufferOptions) => IRenderbuffer;

    readonly createFramebuffer: (options: FramebufferOptions) => IFramebuffer;
    readonly createColorFramebuffer: (
        width: number,
        height: number,
        format?: GLTextureFormat,
        samples?: number
    ) => IFramebuffer;

    readonly createDepthFramebuffer: (
        width: number,
        height: number,
        format?: GLTextureFormat,
        samples?: number
    ) => IFramebuffer;

    readonly createFramebufferWithDepth: (
        width: number,
        height: number,
        colorFormat?: GLTextureFormat,
        depthFormat?: GLTextureFormat,
        samples?: number
    ) => IFramebuffer;
}

const createGLConstants = <T extends number>(
    gl: WebGL2RenderingContext
): Readonly<{
    TEXTURE_2D: T;
    TEXTURE_CUBE_MAP: T;
    TEXTURE_2D_ARRAY: T;
    TEXTURE_3D: T;

    RGB: T;
    RGBA: T;
    RGBA8: T;
    RGBA16F: T;
    RGBA32F: T;
    RGB8: T;
    RGB16F: T;
    RGB32F: T;
    R8: T;
    R16F: T;
    R32F: T;
    RG8: T;
    RG16F: T;
    RG32F: T;
    DEPTH_COMPONENT16: T;
    DEPTH_COMPONENT24: T;
    DEPTH_COMPONENT32F: T;
    DEPTH24_STENCIL8: T;
    DEPTH32F_STENCIL8: T;

    COLOR_ATTACHMENT0: T;
    DEPTH_ATTACHMENT: T;
    STENCIL_ATTACHMENT: T;
    DEPTH_STENCIL_ATTACHMENT: T;

    NEAREST: T;
    LINEAR: T;

    CLAMP_TO_EDGE: T;
    REPEAT: T;
    MIRRORED_REPEAT: T;

    UNSIGNED_BYTE: T;
    FLOAT: T;
    HALF_FLOAT: T;
    UNSIGNED_SHORT: T;
    UNSIGNED_INT: T;
    UNSIGNED_INT_24_8: T;
    FLOAT_32_UNSIGNED_INT_24_8_REV: T;

    FRAMEBUFFER_COMPLETE: T;
    FRAMEBUFFER_INCOMPLETE_ATTACHMENT: T;
    FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: T;
    FRAMEBUFFER_INCOMPLETE_DIMENSIONS: T;
    FRAMEBUFFER_UNSUPPORTED: T;
    FRAMEBUFFER_INCOMPLETE_MULTISAMPLE: T;
}> => {
    return Object.freeze({
        TEXTURE_2D: gl.TEXTURE_2D as T,
        TEXTURE_CUBE_MAP: gl.TEXTURE_CUBE_MAP as T,
        TEXTURE_2D_ARRAY: gl.TEXTURE_2D_ARRAY as T,
        TEXTURE_3D: gl.TEXTURE_3D as T,

        RGB: gl.RGB as T,
        RGBA: gl.RGBA as T,
        RGBA8: gl.RGBA8 as T,
        RGBA16F: gl.RGBA16F as T,
        RGBA32F: gl.RGBA32F as T,
        RGB8: gl.RGB8 as T,
        RGB16F: gl.RGB16F as T,
        RGB32F: gl.RGB32F as T,
        R8: gl.R8 as T,
        R16F: gl.R16F as T,
        R32F: gl.R32F as T,
        RG8: gl.RG8 as T,
        RG16F: gl.RG16F as T,
        RG32F: gl.RG32F as T,
        DEPTH_COMPONENT16: gl.DEPTH_COMPONENT16 as T,
        DEPTH_COMPONENT24: gl.DEPTH_COMPONENT24 as T,
        DEPTH_COMPONENT32F: gl.DEPTH_COMPONENT32F as T,
        DEPTH24_STENCIL8: gl.DEPTH24_STENCIL8 as T,
        DEPTH32F_STENCIL8: gl.DEPTH32F_STENCIL8 as T,

        COLOR_ATTACHMENT0: gl.COLOR_ATTACHMENT0 as T,
        DEPTH_ATTACHMENT: gl.DEPTH_ATTACHMENT as T,
        STENCIL_ATTACHMENT: gl.STENCIL_ATTACHMENT as T,
        DEPTH_STENCIL_ATTACHMENT: gl.DEPTH_STENCIL_ATTACHMENT as T,

        NEAREST: gl.NEAREST as T,
        LINEAR: gl.LINEAR as T,

        CLAMP_TO_EDGE: gl.CLAMP_TO_EDGE as T,
        REPEAT: gl.REPEAT as T,
        MIRRORED_REPEAT: gl.MIRRORED_REPEAT as T,

        UNSIGNED_BYTE: gl.UNSIGNED_BYTE as T,
        FLOAT: gl.FLOAT as T,
        HALF_FLOAT: gl.HALF_FLOAT as T,
        UNSIGNED_SHORT: gl.UNSIGNED_SHORT as T,
        UNSIGNED_INT: gl.UNSIGNED_INT as T,
        UNSIGNED_INT_24_8: gl.UNSIGNED_INT_24_8 as T,
        FLOAT_32_UNSIGNED_INT_24_8_REV: gl.FLOAT_32_UNSIGNED_INT_24_8_REV as T,

        FRAMEBUFFER_COMPLETE: gl.FRAMEBUFFER_COMPLETE as T,
        FRAMEBUFFER_INCOMPLETE_ATTACHMENT: gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT as T,
        FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
            gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT as T,
        FRAMEBUFFER_INCOMPLETE_DIMENSIONS: gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS as T,
        FRAMEBUFFER_UNSUPPORTED: gl.FRAMEBUFFER_UNSUPPORTED as T,
        FRAMEBUFFER_INCOMPLETE_MULTISAMPLE: gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE as T,
    });
};

const getTextureTypeForFormat = (gl: WebGL2RenderingContext, format: GLTextureFormat): GLenum => {
    switch (format) {
        case gl.RGBA8:
        case gl.RGB8:
        case gl.RG8:
        case gl.R8:
            return gl.UNSIGNED_BYTE;
        case gl.RGBA16F:
        case gl.RGB16F:
        case gl.RG16F:
        case gl.R16F:
            return gl.HALF_FLOAT;
        case gl.RGBA32F:
        case gl.RGB32F:
        case gl.RG32F:
        case gl.R32F:
        case gl.DEPTH_COMPONENT32F:
            return gl.FLOAT;
        case gl.DEPTH_COMPONENT16:
            return gl.UNSIGNED_SHORT;
        case gl.DEPTH_COMPONENT24:
            return gl.UNSIGNED_INT;
        case gl.DEPTH24_STENCIL8:
            return gl.UNSIGNED_INT_24_8;
        case gl.DEPTH32F_STENCIL8:
            return gl.FLOAT_32_UNSIGNED_INT_24_8_REV;
        default:
            return gl.UNSIGNED_BYTE;
    }
};

const getPixelFormatForInternalFormat = (
    gl: WebGL2RenderingContext,
    internalFormat: GLTextureFormat
): GLTextureFormat => {
    switch (internalFormat) {
        case gl.RGBA8:
        case gl.RGBA16F:
        case gl.RGBA32F:
            return gl.RGBA as GLTextureFormat;
        case gl.RGB8:
        case gl.RGB16F:
        case gl.RGB32F:
            return gl.RGB as GLTextureFormat;
        case gl.RG8:
        case gl.RG16F:
        case gl.RG32F:
            return gl.RG as GLTextureFormat;
        case gl.R8:
        case gl.R16F:
        case gl.R32F:
            return gl.RED as GLTextureFormat;
        case gl.DEPTH_COMPONENT16:
        case gl.DEPTH_COMPONENT24:
        case gl.DEPTH_COMPONENT32F:
            return gl.DEPTH_COMPONENT as GLTextureFormat;
        case gl.DEPTH24_STENCIL8:
        case gl.DEPTH32F_STENCIL8:
            return gl.DEPTH_STENCIL as GLTextureFormat;
        default:
            return gl.RGBA as GLTextureFormat;
    }
};

const isDepthFormat = (gl: WebGL2RenderingContext, format: GLTextureFormat): boolean => {
    return (
        format === gl.DEPTH_COMPONENT16 ||
        format === gl.DEPTH_COMPONENT24 ||
        format === gl.DEPTH_COMPONENT32F ||
        format === gl.DEPTH24_STENCIL8 ||
        format === gl.DEPTH32F_STENCIL8
    );
};

const isStencilFormat = (gl: WebGL2RenderingContext, format: GLTextureFormat): boolean => {
    return format === gl.DEPTH24_STENCIL8 || format === gl.DEPTH32F_STENCIL8;
};

const validateAttachmentConfig = (gl: WebGL2RenderingContext, config: AttachmentConfig): void => {
    if (!config.texture && !config.renderbuffer) {
        throw new FramebufferError(
            'Attachment config must specify either texture or renderbuffer',
            'INVALID_ATTACHMENT'
        );
    }

    if (config.texture && config.renderbuffer) {
        throw new FramebufferError(
            'Attachment config cannot specify both texture and renderbuffer',
            'INVALID_ATTACHMENT'
        );
    }

    if (config.texture && config.texture.isDisposed) {
        throw new FramebufferError('Cannot attach disposed texture', 'TEXTURE_ALREADY_DISPOSED');
    }

    if (config.renderbuffer && config.renderbuffer.isDisposed) {
        throw new FramebufferError(
            'Cannot attach disposed renderbuffer',
            'RENDERBUFFER_ALREADY_DISPOSED'
        );
    }
};

const getFramebufferStatusString = (
    gl: WebGL2RenderingContext,
    status: FramebufferStatus
): string => {
    switch (status) {
        case gl.FRAMEBUFFER_COMPLETE:
            return 'FRAMEBUFFER_COMPLETE';
        case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
            return 'FRAMEBUFFER_INCOMPLETE_ATTACHMENT';
        case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
            return 'FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT';
        case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
            return 'FRAMEBUFFER_INCOMPLETE_DIMENSIONS';
        case gl.FRAMEBUFFER_UNSUPPORTED:
            return 'FRAMEBUFFER_UNSUPPORTED';
        case gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE:
            return 'FRAMEBUFFER_INCOMPLETE_MULTISAMPLE';
        default:
            return `UNKNOWN_STATUS_${status}`;
    }
};

export class Texture implements ITexture {
    readonly #gl: WebGL2RenderingContext;
    readonly #id: WebGLTexture;
    readonly #target: GLTextureTarget;
    readonly #constants: ReturnType<typeof createGLConstants>;

    #width: number;
    #height: number;
    #format: GLTextureFormat;
    #internalFormat: GLTextureFormat;
    #type: GLenum;
    #samples: number;
    #label: string | null;
    #isDisposed: boolean = false;

    public get id(): TextureId {
        this.#throwIfDisposed();
        return this.#id as TextureId;
    }

    public get target(): GLTextureTarget {
        return this.#target;
    }

    public get width(): number {
        return this.#width;
    }

    public get height(): number {
        return this.#height;
    }

    public get format(): GLTextureFormat {
        return this.#format;
    }

    public get internalFormat(): GLTextureFormat {
        return this.#internalFormat;
    }

    public get type(): GLenum {
        return this.#type;
    }

    public get samples(): number {
        return this.#samples;
    }

    public get label(): string | null {
        return this.#label;
    }

    public get isDisposed(): boolean {
        return this.#isDisposed;
    }

    constructor(gl: WebGL2RenderingContext, target: GLTextureTarget, options: TextureOptions) {
        const {
            width,
            height,
            format,
            internalFormat = format ?? gl.RGBA8,
            type,
            minFilter = gl.LINEAR,
            magFilter = gl.LINEAR,
            wrapS = gl.CLAMP_TO_EDGE,
            wrapT = gl.CLAMP_TO_EDGE,
            generateMipmap = false,
            samples = 0,
            label = null,
        } = options;

        this.#gl = gl;
        this.#target = target;
        this.#width = width;
        this.#height = height;
        this.#internalFormat = internalFormat;
        this.#format = format ?? getPixelFormatForInternalFormat(gl, internalFormat);
        this.#type = type ?? getTextureTypeForFormat(gl, internalFormat);
        this.#samples = samples;
        this.#label = label;
        this.#constants = createGLConstants(gl);

        const texture = gl.createTexture();
        if (!texture) {
            throw new FramebufferError('Failed to create WebGLTexture', 'OUT_OF_MEMORY');
        }
        this.#id = texture;

        this.bind();

        if (samples > 0) {
            throw new FramebufferError(
                'Multisampled textures should be handled via renderbuffers for better compatibility',
                'UNSUPPORTED_OPERATION'
            );
        } else if (target === gl.TEXTURE_2D) {
            gl.texStorage2D(target, 1, internalFormat, width, height);
        } else if (target === gl.TEXTURE_CUBE_MAP) {
            gl.texStorage2D(target, 1, internalFormat, width, height);
        }

        if (samples === 0) {
            gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, minFilter);
            gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, magFilter);
            gl.texParameteri(target, gl.TEXTURE_WRAP_S, wrapS);
            gl.texParameteri(target, gl.TEXTURE_WRAP_T, wrapT);

            if (generateMipmap) {
                this.generateMipmap();
            }
        }

        this.unbind();

        const debugExt = this.#gl.getExtension('KHR_debug');
        if (debugExt && typeof debugExt.labelObject === 'function' && label) {
            debugExt.labelObject(debugExt.TEXTURE, this.#id, label);
        }
    }

    public bind = (): ITexture => {
        this.#throwIfDisposed();
        this.#gl.bindTexture(this.#target, this.#id);
        return this;
    };

    public unbind = (): ITexture => {
        this.#throwIfDisposed();
        this.#gl.bindTexture(this.#target, null);
        return this;
    };

    public resize = (width: number, height: number): ITexture => {
        this.#throwIfDisposed();

        if (width <= 0 || height <= 0) {
            throw new FramebufferError(`Invalid dimensions: ${width}x${height}`, 'INVALID_VALUE');
        }

        if (this.#samples > 0) {
            throw new FramebufferError(
                'Cannot resize multisampled textures directly',
                'INVALID_OPERATION'
            );
        }

        this.#width = width;
        this.#height = height;

        this.bind();

        if (this.#target === this.#gl.TEXTURE_2D) {
            this.#gl.texStorage2D(this.#target, 1, this.#internalFormat, width, height);
        }

        this.unbind();
        return this;
    };

    public generateMipmap = (): ITexture => {
        this.#throwIfDisposed();

        if (this.#samples > 0) {
            throw new FramebufferError(
                'Cannot generate mipmaps for multisampled textures',
                'INVALID_OPERATION'
            );
        }

        this.bind();
        this.#gl.generateMipmap(this.#target);
        this.unbind();
        return this;
    };

    public setData = (
        data: TexImageSource | ArrayBufferView | null,
        level: number = 0
    ): ITexture => {
        this.#throwIfDisposed();

        if (this.#samples > 0) {
            throw new FramebufferError(
                'Cannot set data on multisampled textures',
                'INVALID_OPERATION'
            );
        }

        this.bind();

        if (this.#target === this.#gl.TEXTURE_2D) {
            if (data === null) {
                this.#gl.texSubImage2D(
                    this.#target,
                    level,
                    0,
                    0,
                    this.#width,
                    this.#height,
                    this.#format,
                    this.#type,
                    null
                );
            } else if (
                data instanceof HTMLImageElement ||
                data instanceof HTMLCanvasElement ||
                data instanceof HTMLVideoElement ||
                data instanceof ImageBitmap ||
                data instanceof ImageData
            ) {
                this.#gl.texSubImage2D(this.#target, level, 0, 0, this.#format, this.#type, data);
            } else if (ArrayBuffer.isView(data)) {
                this.#gl.texSubImage2D(
                    this.#target,
                    level,
                    0,
                    0,
                    this.#width,
                    this.#height,
                    this.#format,
                    this.#type,
                    data
                );
            }
        }

        this.unbind();
        return this;
    };

    public getPixels = <T extends ArrayBufferView>(output: T, level: number = 0): T => {
        this.#throwIfDisposed();

        if (this.#samples > 0) {
            throw new FramebufferError(
                'Cannot read pixels from multisampled textures directly',
                'INVALID_OPERATION'
            );
        }

        throw new FramebufferError(
            'Direct texture pixel reading not supported. Use framebuffer readPixels instead.',
            'UNSUPPORTED_OPERATION'
        );
    };

    public dispose = (): void => {
        if (this.#isDisposed) return;

        this.#gl.deleteTexture(this.#id);
        this.#isDisposed = true;
    };

    #throwIfDisposed = (): void => {
        if (this.#isDisposed) {
            throw new FramebufferError('Texture has been disposed', 'TEXTURE_ALREADY_DISPOSED');
        }
    };
}

export class Renderbuffer implements IRenderbuffer {
    readonly #gl: WebGL2RenderingContext;
    readonly #id: WebGLRenderbuffer;
    readonly #constants: ReturnType<typeof createGLConstants>;

    #width: number;
    #height: number;
    #internalFormat: GLTextureFormat;
    #samples: number;
    #label: string | null;
    #isDisposed: boolean = false;

    public get id(): RenderbufferId {
        this.#throwIfDisposed();
        return this.#id as RenderbufferId;
    }

    public get width(): number {
        return this.#width;
    }

    public get height(): number {
        return this.#height;
    }

    public get internalFormat(): GLTextureFormat {
        return this.#internalFormat;
    }

    public get samples(): number {
        return this.#samples;
    }

    public get label(): string | null {
        return this.#label;
    }

    public get isDisposed(): boolean {
        return this.#isDisposed;
    }

    constructor(gl: WebGL2RenderingContext, options: RenderbufferOptions) {
        const { width, height, internalFormat, samples = 0, label = null } = options;

        this.#gl = gl;
        this.#width = width;
        this.#height = height;
        this.#internalFormat = internalFormat;
        this.#samples = samples;
        this.#label = label;
        this.#constants = createGLConstants(gl);

        const renderbuffer = gl.createRenderbuffer();
        if (!renderbuffer) {
            throw new FramebufferError('Failed to create WebGLRenderbuffer', 'OUT_OF_MEMORY');
        }
        this.#id = renderbuffer;

        this.bind();

        if (samples > 0) {
            gl.renderbufferStorageMultisample(
                gl.RENDERBUFFER,
                samples,
                internalFormat,
                width,
                height
            );
        } else {
            gl.renderbufferStorage(gl.RENDERBUFFER, internalFormat, width, height);
        }

        this.unbind();

        const debugExt = this.#gl.getExtension('KHR_debug');
        if (debugExt && typeof debugExt.labelObject === 'function' && label) {
            debugExt.labelObject(debugExt.RENDERBUFFER, this.#id, label);
        }
    }

    public bind = (): IRenderbuffer => {
        this.#throwIfDisposed();
        this.#gl.bindRenderbuffer(this.#gl.RENDERBUFFER, this.#id);
        return this;
    };

    public unbind = (): IRenderbuffer => {
        this.#throwIfDisposed();
        this.#gl.bindRenderbuffer(this.#gl.RENDERBUFFER, null);
        return this;
    };

    public resize = (width: number, height: number, samples?: number): IRenderbuffer => {
        this.#throwIfDisposed();

        if (width <= 0 || height <= 0) {
            throw new FramebufferError(`Invalid dimensions: ${width}x${height}`, 'INVALID_VALUE');
        }

        this.#width = width;
        this.#height = height;
        if (samples !== undefined) {
            this.#samples = samples;
        }

        this.bind();

        if (this.#samples > 0) {
            this.#gl.renderbufferStorageMultisample(
                this.#gl.RENDERBUFFER,
                this.#samples,
                this.#internalFormat,
                width,
                height
            );
        } else {
            this.#gl.renderbufferStorage(
                this.#gl.RENDERBUFFER,
                this.#internalFormat,
                width,
                height
            );
        }

        this.unbind();
        return this;
    };

    public dispose = (): void => {
        if (this.#isDisposed) return;

        this.#gl.deleteRenderbuffer(this.#id);
        this.#isDisposed = true;
    };

    #throwIfDisposed = (): void => {
        if (this.#isDisposed) {
            throw new FramebufferError(
                'Renderbuffer has been disposed',
                'RENDERBUFFER_ALREADY_DISPOSED'
            );
        }
    };
}

export class Framebuffer implements IFramebuffer {
    readonly #gl: WebGL2RenderingContext;
    readonly #id: WebGLFramebuffer;
    readonly #constants: ReturnType<typeof createGLConstants>;

    #width: number;
    #height: number;
    #label: string | null;
    #isDisposed: boolean = false;
    #colorAttachments: ITexture[] = [];
    #depthAttachment: ITexture | IRenderbuffer | null = null;
    #stencilAttachment: ITexture | IRenderbuffer | null = null;
    #depthStencilAttachment: ITexture | IRenderbuffer | null = null;

    public get id(): FramebufferId {
        this.#throwIfDisposed();
        return this.#id as FramebufferId;
    }

    public get width(): number {
        return this.#width;
    }

    public get height(): number {
        return this.#height;
    }

    public get label(): string | null {
        return this.#label;
    }

    public get isDisposed(): boolean {
        return this.#isDisposed;
    }

    public get colorAttachments(): readonly ITexture[] {
        return [...this.#colorAttachments];
    }

    public get depthAttachment(): ITexture | IRenderbuffer | null {
        return this.#depthAttachment;
    }

    public get stencilAttachment(): ITexture | IRenderbuffer | null {
        return this.#stencilAttachment;
    }

    public get depthStencilAttachment(): ITexture | IRenderbuffer | null {
        return this.#depthStencilAttachment;
    }

    public get isComplete(): boolean {
        this.#throwIfDisposed();
        this.bind();
        const status = this.#gl.checkFramebufferStatus(this.#gl.FRAMEBUFFER);
        this.unbind();
        return status === this.#gl.FRAMEBUFFER_COMPLETE;
    }

    public get status(): FramebufferStatus {
        this.#throwIfDisposed();
        this.bind();
        const status = this.#gl.checkFramebufferStatus(this.#gl.FRAMEBUFFER) as FramebufferStatus;
        this.unbind();
        return status;
    }

    constructor(gl: WebGL2RenderingContext, options: FramebufferOptions) {
        const {
            width,
            height,
            colorAttachments = [],
            depthAttachment,
            stencilAttachment,
            depthStencilAttachment,
            label = null,
        } = options;

        this.#gl = gl;
        this.#width = width;
        this.#height = height;
        this.#label = label;
        this.#constants = createGLConstants(gl);

        const framebuffer = gl.createFramebuffer();
        if (!framebuffer) {
            throw new FramebufferError('Failed to create WebGLFramebuffer', 'OUT_OF_MEMORY');
        }
        this.#id = framebuffer;

        this.bind();

        for (const config of colorAttachments) {
            this.#attachInternal(config);
        }

        if (depthAttachment) {
            this.#attachInternal(depthAttachment);
        }

        if (stencilAttachment) {
            this.#attachInternal(stencilAttachment);
        }

        if (depthStencilAttachment) {
            this.#attachInternal(depthStencilAttachment);
        }

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            this.unbind();
            throw new FramebufferError(
                `Framebuffer incomplete: ${getFramebufferStatusString(gl, status as FramebufferStatus)}`,
                'INCOMPLETE_FRAMEBUFFER'
            );
        }

        this.unbind();

        const debugExt = this.#gl.getExtension('KHR_debug');
        if (debugExt && typeof debugExt.labelObject === 'function' && label) {
            debugExt.labelObject(debugExt.FRAMEBUFFER, this.#id, label);
        }
    }

    public bind = (): IFramebuffer => {
        this.#throwIfDisposed();
        this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, this.#id);
        this.#gl.viewport(0, 0, this.#width, this.#height);
        return this;
    };

    public unbind = (): IFramebuffer => {
        this.#throwIfDisposed();
        this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, null);
        return this;
    };

    public attachTexture = (
        attachment: GLAttachment,
        texture: ITexture,
        level: number = 0,
        layer?: number
    ): IFramebuffer => {
        this.#throwIfDisposed();

        if (texture.isDisposed) {
            throw new FramebufferError(
                'Cannot attach disposed texture',
                'TEXTURE_ALREADY_DISPOSED'
            );
        }

        this.bind();

        if (layer !== undefined && texture.target === this.#gl.TEXTURE_2D_ARRAY) {
            this.#gl.framebufferTextureLayer(
                this.#gl.FRAMEBUFFER,
                attachment,
                texture.id as WebGLTexture,
                level,
                layer
            );
        } else {
            this.#gl.framebufferTexture2D(
                this.#gl.FRAMEBUFFER,
                attachment,
                texture.target,
                texture.id as WebGLTexture,
                level
            );
        }

        this.#updateAttachmentReferences(attachment, texture);
        this.unbind();
        return this;
    };

    public attachRenderbuffer = (
        attachment: GLAttachment,
        renderbuffer: IRenderbuffer
    ): IFramebuffer => {
        this.#throwIfDisposed();

        if (renderbuffer.isDisposed) {
            throw new FramebufferError(
                'Cannot attach disposed renderbuffer',
                'RENDERBUFFER_ALREADY_DISPOSED'
            );
        }

        this.bind();
        this.#gl.framebufferRenderbuffer(
            this.#gl.FRAMEBUFFER,
            attachment,
            this.#gl.RENDERBUFFER,
            renderbuffer.id as WebGLRenderbuffer
        );

        this.#updateAttachmentReferences(attachment, renderbuffer);
        this.unbind();
        return this;
    };

    public detach = (attachment: GLAttachment): IFramebuffer => {
        this.#throwIfDisposed();

        this.bind();
        this.#gl.framebufferTexture2D(
            this.#gl.FRAMEBUFFER,
            attachment,
            this.#gl.TEXTURE_2D,
            null,
            0
        );

        this.#updateAttachmentReferences(attachment, null);
        this.unbind();
        return this;
    };

    public resize = (width: number, height: number): IFramebuffer => {
        this.#throwIfDisposed();

        if (width <= 0 || height <= 0) {
            throw new FramebufferError(`Invalid dimensions: ${width}x${height}`, 'INVALID_VALUE');
        }

        this.#width = width;
        this.#height = height;

        for (const texture of this.#colorAttachments) {
            if (!texture.isDisposed) {
                texture.resize(width, height);
            }
        }

        if (this.#depthAttachment && !this.#depthAttachment.isDisposed) {
            this.#depthAttachment.resize(width, height);
        }

        if (this.#stencilAttachment && !this.#stencilAttachment.isDisposed) {
            this.#stencilAttachment.resize(width, height);
        }

        if (this.#depthStencilAttachment && !this.#depthStencilAttachment.isDisposed) {
            this.#depthStencilAttachment.resize(width, height);
        }

        return this;
    };

    public clear = (
        color?: [number, number, number, number],
        depth?: number,
        stencil?: number
    ): IFramebuffer => {
        this.#throwIfDisposed();

        this.bind();

        let mask = 0;

        if (color !== undefined && this.#colorAttachments.length > 0) {
            this.#gl.clearColor(color[0], color[1], color[2], color[3]);
            mask |= this.#gl.COLOR_BUFFER_BIT;
        }

        if (depth !== undefined && (this.#depthAttachment || this.#depthStencilAttachment)) {
            this.#gl.clearDepth(depth);
            mask |= this.#gl.DEPTH_BUFFER_BIT;
        }

        if (stencil !== undefined && (this.#stencilAttachment || this.#depthStencilAttachment)) {
            this.#gl.clearStencil(stencil);
            mask |= this.#gl.STENCIL_BUFFER_BIT;
        }

        if (mask > 0) {
            this.#gl.clear(mask);
        }

        this.unbind();
        return this;
    };

    public readPixels = <T extends ArrayBufferView>(
        output: T,
        x: number = 0,
        y: number = 0,
        width: number = this.#width,
        height: number = this.#height,
        attachment: GLAttachment = this.#gl.COLOR_ATTACHMENT0
    ): T => {
        this.#throwIfDisposed();

        this.bind();

        if (attachment >= this.#gl.COLOR_ATTACHMENT0 && attachment <= this.#gl.COLOR_ATTACHMENT15) {
            this.#gl.readBuffer(attachment);
        }

        const format = this.#gl.RGBA;
        const type = this.#gl.UNSIGNED_BYTE;

        this.#gl.readPixels(x, y, width, height, format, type, output);

        this.unbind();
        return output;
    };

    public blit = (
        source: IFramebuffer,
        srcRect: [number, number, number, number] = [0, 0, source.width, source.height],
        dstRect: [number, number, number, number] = [0, 0, this.#width, this.#height],
        mask: GLbitfield = this.#gl.COLOR_BUFFER_BIT,
        filter: GLFilterMode = this.#gl.NEAREST
    ): IFramebuffer => {
        this.#throwIfDisposed();

        if (source.isDisposed) {
            throw new FramebufferError(
                'Cannot blit from disposed framebuffer',
                'FRAMEBUFFER_ALREADY_DISPOSED'
            );
        }

        this.#gl.bindFramebuffer(this.#gl.READ_FRAMEBUFFER, source.id as WebGLFramebuffer);
        this.#gl.bindFramebuffer(this.#gl.DRAW_FRAMEBUFFER, this.#id);

        this.#gl.blitFramebuffer(
            srcRect[0],
            srcRect[1],
            srcRect[2],
            srcRect[3],
            dstRect[0],
            dstRect[1],
            dstRect[2],
            dstRect[3],
            mask,
            filter
        );

        this.#gl.bindFramebuffer(this.#gl.READ_FRAMEBUFFER, null);
        this.#gl.bindFramebuffer(this.#gl.DRAW_FRAMEBUFFER, null);

        return this;
    };

    public dispose = (): void => {
        if (this.#isDisposed) return;

        this.#gl.deleteFramebuffer(this.#id);
        this.#isDisposed = true;

        this.#colorAttachments.length = 0;
        this.#depthAttachment = null;
        this.#stencilAttachment = null;
        this.#depthStencilAttachment = null;
    };

    #attachInternal = (config: AttachmentConfig): void => {
        validateAttachmentConfig(this.#gl, config);

        if (config.texture) {
            this.attachTexture(config.attachment, config.texture, config.level, config.layer);
        } else if (config.renderbuffer) {
            this.attachRenderbuffer(config.attachment, config.renderbuffer);
        }
    };

    #updateAttachmentReferences = (
        attachment: GLAttachment,
        resource: ITexture | IRenderbuffer | null
    ): void => {
        const gl = this.#gl;

        if (attachment >= gl.COLOR_ATTACHMENT0 && attachment <= gl.COLOR_ATTACHMENT15) {
            const index = attachment - gl.COLOR_ATTACHMENT0;

            while (this.#colorAttachments.length <= index) {
                this.#colorAttachments.push(null as any);
            }

            this.#colorAttachments[index] = resource as ITexture;
        } else if (attachment === gl.DEPTH_ATTACHMENT) {
            this.#depthAttachment = resource;
        } else if (attachment === gl.STENCIL_ATTACHMENT) {
            this.#stencilAttachment = resource;
        } else if (attachment === gl.DEPTH_STENCIL_ATTACHMENT) {
            this.#depthStencilAttachment = resource;
        }
    };

    #throwIfDisposed = (): void => {
        if (this.#isDisposed) {
            throw new FramebufferError(
                'Framebuffer has been disposed',
                'FRAMEBUFFER_ALREADY_DISPOSED'
            );
        }
    };
}

export class FramebufferFactory implements IFramebufferFactory {
    readonly #gl: WebGL2RenderingContext;
    readonly #constants: ReturnType<typeof createGLConstants>;

    constructor(gl: WebGL2RenderingContext) {
        this.#gl = gl;
        this.#constants = createGLConstants(gl);
    }

    public createTexture = (target: GLTextureTarget, options: TextureOptions): ITexture => {
        return new Texture(this.#gl, target, options);
    };

    public createTexture2D = (options: TextureOptions): ITexture => {
        return this.createTexture(this.#gl.TEXTURE_2D, options);
    };

    public createTextureCube = (options: TextureOptions): ITexture => {
        return this.createTexture(this.#gl.TEXTURE_CUBE_MAP, options);
    };

    public createTexture2DArray = (options: TextureOptions & { depth: number }): ITexture => {
        return this.createTexture(this.#gl.TEXTURE_2D_ARRAY, options);
    };

    public createTexture3D = (options: TextureOptions & { depth: number }): ITexture => {
        return this.createTexture(this.#gl.TEXTURE_3D, options);
    };

    public createRenderbuffer = (options: RenderbufferOptions): IRenderbuffer => {
        return new Renderbuffer(this.#gl, options);
    };

    public createFramebuffer = (options: FramebufferOptions): IFramebuffer => {
        return new Framebuffer(this.#gl, options);
    };

    public createColorFramebuffer = (
        width: number,
        height: number,
        format: GLTextureFormat = this.#gl.RGBA8,
        samples: number = 0
    ): IFramebuffer => {
        const colorTexture = this.createTexture2D({
            width,
            height,
            internalFormat: format,
            samples,
            label: 'ColorFramebuffer_ColorAttachment',
        });

        return this.createFramebuffer({
            width,
            height,
            colorAttachments: [
                {
                    attachment: this.#gl.COLOR_ATTACHMENT0,
                    texture: colorTexture,
                },
            ],
            label: 'ColorFramebuffer',
        });
    };

    public createDepthFramebuffer = (
        width: number,
        height: number,
        format: GLTextureFormat = this.#gl.DEPTH_COMPONENT24,
        samples: number = 0
    ): IFramebuffer => {
        if (samples > 0) {
            const depthRenderbuffer = this.createRenderbuffer({
                width,
                height,
                internalFormat: format,
                samples,
                label: 'DepthFramebuffer_DepthAttachment',
            });

            return this.createFramebuffer({
                width,
                height,
                depthAttachment: {
                    attachment: this.#gl.DEPTH_ATTACHMENT,
                    renderbuffer: depthRenderbuffer,
                },
                label: 'DepthFramebuffer',
            });
        } else {
            const depthTexture = this.createTexture2D({
                width,
                height,
                internalFormat: format,
                minFilter: this.#gl.NEAREST,
                magFilter: this.#gl.NEAREST,
                label: 'DepthFramebuffer_DepthAttachment',
            });

            return this.createFramebuffer({
                width,
                height,
                depthAttachment: {
                    attachment: this.#gl.DEPTH_ATTACHMENT,
                    texture: depthTexture,
                },
                label: 'DepthFramebuffer',
            });
        }
    };

    public createFramebufferWithDepth = (
        width: number,
        height: number,
        colorFormat: GLTextureFormat = this.#gl.RGBA8,
        depthFormat: GLTextureFormat = this.#gl.DEPTH_COMPONENT24,
        samples: number = 0
    ): IFramebuffer => {
        const colorTexture = this.createTexture2D({
            width,
            height,
            internalFormat: colorFormat,
            samples,
            label: 'FramebufferWithDepth_ColorAttachment',
        });

        if (samples > 0) {
            const depthRenderbuffer = this.createRenderbuffer({
                width,
                height,
                internalFormat: depthFormat,
                samples,
                label: 'FramebufferWithDepth_DepthAttachment',
            });

            return this.createFramebuffer({
                width,
                height,
                colorAttachments: [
                    {
                        attachment: this.#gl.COLOR_ATTACHMENT0,
                        texture: colorTexture,
                    },
                ],
                depthAttachment: {
                    attachment: this.#gl.DEPTH_ATTACHMENT,
                    renderbuffer: depthRenderbuffer,
                },
                label: 'FramebufferWithDepth',
            });
        } else {
            const depthTexture = this.createTexture2D({
                width,
                height,
                internalFormat: depthFormat,
                minFilter: this.#gl.NEAREST,
                magFilter: this.#gl.NEAREST,
                label: 'FramebufferWithDepth_DepthAttachment',
            });

            return this.createFramebuffer({
                width,
                height,
                colorAttachments: [
                    {
                        attachment: this.#gl.COLOR_ATTACHMENT0,
                        texture: colorTexture,
                    },
                ],
                depthAttachment: {
                    attachment: this.#gl.DEPTH_ATTACHMENT,
                    texture: depthTexture,
                },
                label: 'FramebufferWithDepth',
            });
        }
    };
}

export const createFramebufferFactory = (gl: WebGL2RenderingContext): IFramebufferFactory => {
    return new FramebufferFactory(gl);
};

export const createRenderTarget = (
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    options: {
        colorFormat?: GLTextureFormat;
        depthFormat?: GLTextureFormat;
        samples?: number;
        useDepth?: boolean;
        useStencil?: boolean;
        label?: string;
    } = {}
): IFramebuffer => {
    const {
        colorFormat = gl.RGBA8,
        depthFormat = gl.DEPTH24_STENCIL8,
        samples = 0,
        useDepth = true,
        useStencil = false,
        label = 'RenderTarget',
    } = options;

    const factory = createFramebufferFactory(gl);

    if (useDepth || useStencil) {
        const actualDepthFormat =
            useDepth && useStencil
                ? depthFormat
                : useDepth
                  ? (gl.DEPTH_COMPONENT24 as GLTextureFormat)
                  : (gl.STENCIL_INDEX8 as GLTextureFormat);

        return factory.createFramebufferWithDepth(
            width,
            height,
            colorFormat,
            actualDepthFormat,
            samples
        );
    } else {
        return factory.createColorFramebuffer(width, height, colorFormat, samples);
    }
};

export const createShadowMap = (
    gl: WebGL2RenderingContext,
    size: number,
    format: GLTextureFormat = gl.DEPTH_COMPONENT24
): IFramebuffer => {
    const factory = createFramebufferFactory(gl);
    return factory.createDepthFramebuffer(size, size, format);
};

export const createMultisampledRenderTarget = (
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    samples: number,
    colorFormat: GLTextureFormat = gl.RGBA8,
    depthFormat: GLTextureFormat = gl.DEPTH24_STENCIL8
): { msaaTarget: IFramebuffer; resolveTarget: IFramebuffer } => {
    const factory = createFramebufferFactory(gl);

    const msaaTarget = factory.createFramebufferWithDepth(
        width,
        height,
        colorFormat,
        depthFormat,
        samples
    );

    const resolveTarget = factory.createFramebufferWithDepth(
        width,
        height,
        colorFormat,
        depthFormat,
        0
    );

    return { msaaTarget, resolveTarget };
};
