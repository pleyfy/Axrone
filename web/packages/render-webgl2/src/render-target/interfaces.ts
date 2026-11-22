import type { IDisposable } from '../disposable';
import type { IBindableTarget } from '../interfaces';
import type {
    FramebufferId,
    FramebufferStatus,
    GLAttachment,
    GLFilterMode,
    GLTextureFormat,
    GLTextureTarget,
    GLWrapMode,
    RenderbufferId,
    TextureId,
} from './types';

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
        attachment?: GLAttachment,
        format?: GLenum,
        type?: GLenum
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
