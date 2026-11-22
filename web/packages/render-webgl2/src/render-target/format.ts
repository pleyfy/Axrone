import type { IRenderbuffer, ITexture } from './interfaces';
import type { GLTextureFormat } from './types';

export const getTextureTypeForFormat = (
    gl: WebGL2RenderingContext,
    format: GLTextureFormat
): GLenum => {
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

export const getPixelFormatForInternalFormat = (
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

export const isDepthFormat = (gl: WebGL2RenderingContext, format: GLTextureFormat): boolean => {
    return (
        format === gl.DEPTH_COMPONENT16 ||
        format === gl.DEPTH_COMPONENT24 ||
        format === gl.DEPTH_COMPONENT32F ||
        format === gl.DEPTH24_STENCIL8 ||
        format === gl.DEPTH32F_STENCIL8
    );
};

export const isStencilFormat = (gl: WebGL2RenderingContext, format: GLTextureFormat): boolean => {
    return format === gl.DEPTH24_STENCIL8 || format === gl.DEPTH32F_STENCIL8;
};

export const getAttachmentInternalFormat = (
    resource: ITexture | IRenderbuffer | null
): GLTextureFormat | null => {
    if (!resource || resource.isDisposed) return null;
    return resource.internalFormat;
};

export const inferReadFormat = (
    gl: WebGL2RenderingContext,
    internalFormat: GLTextureFormat
): GLenum => {
    return getPixelFormatForInternalFormat(gl, internalFormat) as GLenum;
};

export const inferReadType = (
    gl: WebGL2RenderingContext,
    internalFormat: GLTextureFormat
): GLenum => {
    return getTextureTypeForFormat(gl, internalFormat);
};
